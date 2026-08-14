import { createFileRoute } from "@tanstack/react-router";

import { verifyWebhookHmac } from "@/lib/shopify.server";

const GDPR_TOPICS = new Set(["shop/redact", "customers/redact", "customers/data_request"]);

export const Route = createFileRoute("/api/public/shopify/webhooks")({
  server: {
    handlers: {
      // Receiver only: verify HMAC, then enqueue. No Shopify calls, no heavy work here.
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const hmac = request.headers.get("x-shopify-hmac-sha256");

        if (!(await verifyWebhookHmac(rawBody, hmac))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
        const shop = (request.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
        const webhookId = request.headers.get("x-shopify-webhook-id");

        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          payload = {};
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: stores } = await supabaseAdmin
          .from("stores")
          .select("id, user_id")
          .eq("shopify_domain", shop);

        if (GDPR_TOPICS.has(topic)) {
          for (const store of stores ?? []) {
            await supabaseAdmin.from("event_log").insert({
              user_id: store.user_id,
              store_id: store.id,
              origin_store_id: store.id,
              webhook_id: webhookId,
              entity_type: "gdpr",
              field: topic,
              source: "webhook",
              status: "applied",
              message: `GDPR isteği alındı: ${topic}`,
            });
            if (topic === "shop/redact") {
              await supabaseAdmin
                .from("stores")
                .update({ status: "redacted", access_token_encrypted: null })
                .eq("id", store.id);
            }
          }
          return new Response("ok");
        }

        if (!stores?.length) {
          // Unknown shop: acknowledge so Shopify stops retrying.
          return new Response("ok");
        }

        for (const store of stores) {
          const { error } = await supabaseAdmin.from("sync_queue").insert({
            user_id: store.user_id,
            store_id: store.id,
            webhook_topic: topic,
            webhook_id: webhookId ? `${webhookId}:${store.id}` : null,
            payload,
            status: "pending",
          });
          // Duplicate webhook id means we already queued it — idempotent by design.
          if (error && !error.message.includes("duplicate key")) {
            console.error("queue insert failed", error.message);
            return new Response("queue error", { status: 500 });
          }
        }

        return new Response("ok");
      },
    },
  },
});
