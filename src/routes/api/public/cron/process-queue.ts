import { createFileRoute } from "@tanstack/react-router";

import { processQueueItem, type QueueRow } from "@/lib/sync-engine.server";

const MAX_BATCH = 15;
const MAX_ATTEMPTS = 5;

async function runBatch() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pending, error } = await supabaseAdmin
    .from("sync_queue")
    .select("id, user_id, store_id, webhook_topic, webhook_id, payload, attempts")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) throw new Error(error.message);

  const results: Array<{ id: string; status: string; note: string }> = [];

  for (const row of pending ?? []) {
    await supabaseAdmin
      .from("sync_queue")
      .update({ status: "processing", attempts: (row.attempts ?? 0) + 1 })
      .eq("id", row.id);

    try {
      const outcome = await processQueueItem(supabaseAdmin as never, row as unknown as QueueRow);
      await supabaseAdmin
        .from("sync_queue")
        .update({
          status: outcome.status === "failed" ? "failed" : "done",
          processed_at: new Date().toISOString(),
          last_error: outcome.status === "failed" ? outcome.note : null,
        })
        .eq("id", row.id);
      results.push({ id: row.id, status: outcome.status, note: outcome.note });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Bilinmeyen hata";
      const attempts = (row.attempts ?? 0) + 1;
      await supabaseAdmin
        .from("sync_queue")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          last_error: message,
          processed_at: attempts >= MAX_ATTEMPTS ? new Date().toISOString() : null,
        })
        .eq("id", row.id);
      results.push({ id: row.id, status: "error", note: message });
    }
  }

  return { processed: results.length, results };
}

export const Route = createFileRoute("/api/public/cron/process-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
        if (!apiKey || !expected || apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await runBatch();
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("queue processor failed", error);
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "unknown" },
            { status: 500 },
          );
        }
      },
    },
  },
});
