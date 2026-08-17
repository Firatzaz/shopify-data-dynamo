// Server-only implementations behind the app's server functions.
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptToken } from "./crypto.server";
import {
  buildAuthorizeUrl,
  fetchAllInventoryState,
  findVariantBySku,
  isValidShopDomain,
  normalizeDomain,
  registerWebhooks,
  setInventoryQuantity,
  shopifyGraphQL,
} from "./shopify.server";
import { processQueueItem, type QueueRow } from "./sync-engine.server";

type Client = SupabaseClient<any, "public", any>;

export type StoreSummary = {
  id: string;
  shopify_domain: string;
  label: string | null;
  role: string;
  status: string;
  installed_at: string | null;
  last_sync_at: string | null;
  created_at: string;
};

export async function listStores(supabase: Client): Promise<StoreSummary[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, shopify_domain, label, role, status, installed_at, last_sync_at, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreSummary[];
}

export async function beginInstall(
  supabase: Client,
  userId: string,
  origin: string,
  input: { domain: string; label?: string; role: string },
): Promise<{ authorizeUrl: string }> {
  if (!process.env["SHOPIFY_API_KEY"] || !process.env["SHOPIFY_API_SECRET"]) {
    throw new Error(
      "Shopify uygulama anahtarları henüz tanımlı değil. Yönetici SHOPIFY_API_KEY ve SHOPIFY_API_SECRET eklemeli.",
    );
  }

  const domain = normalizeDomain(input.domain);
  if (!isValidShopDomain(domain)) {
    throw new Error("Geçerli bir mağaza adresi girin (örn. magazam.myshopify.com)");
  }

  const { error: storeError } = await supabase.from("stores").upsert(
    {
      user_id: userId,
      shopify_domain: domain,
      label: input.label || domain,
      role: input.role,
      status: "pending",
    },
    { onConflict: "user_id,shopify_domain" },
  );
  if (storeError) throw new Error(storeError.message);

  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("oauth_states").insert({
    state,
    user_id: userId,
    shopify_domain: domain,
    label: input.label ?? null,
    role: input.role,
  });
  if (error) throw new Error(error.message);

  return {
    authorizeUrl: buildAuthorizeUrl({
      domain,
      state,
      redirectUri: `${origin}/api/public/shopify/callback`,
    }),
  };
}

export async function deleteStore(supabase: Client, storeId: string) {
  const { error } = await supabase.from("stores").delete().eq("id", storeId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function testStore(supabase: Client, storeId: string) {
  const { data: store, error } = await supabase
    .from("stores")
    .select("id, shopify_domain, api_version, status")
    .eq("id", storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!store) throw new Error("Mağaza bulunamadı");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: secret } = await supabaseAdmin
    .from("stores")
    .select("access_token_encrypted")
    .eq("id", storeId)
    .maybeSingle();

  if (!secret?.access_token_encrypted) {
    return { ok: false, message: "Bu mağaza için erişim izni yok — kurulumu tamamlayın." };
  }

  const token = await decryptToken(secret.access_token_encrypted);
  try {
    const data = await shopifyGraphQL<{
      shop: { name: string; currencyCode: string };
      productVariants: { nodes: Array<{ id: string }> };
    }>({
      domain: store.shopify_domain,
      accessToken: token,
      apiVersion: store.api_version,
      query: `query { shop { name currencyCode } productVariants(first: 1) { nodes { id } } }`,
    });
    return {
      ok: true,
      message: `Bağlantı çalışıyor: ${data.shop.name} (${data.shop.currencyCode})`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Bağlantı hatası" };
  }
}

export async function refreshWebhooks(supabase: Client, storeId: string, origin: string) {
  const { data: store } = await supabase
    .from("stores")
    .select("id, shopify_domain")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) throw new Error("Mağaza bulunamadı");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: secret } = await supabaseAdmin
    .from("stores")
    .select("access_token_encrypted")
    .eq("id", storeId)
    .maybeSingle();
  if (!secret?.access_token_encrypted) throw new Error("Mağaza erişimi yok");

  const token = await decryptToken(secret.access_token_encrypted);
  const result = await registerWebhooks(
    store.shopify_domain,
    token,
    `${origin}/api/public/shopify/webhooks`,
  );
  return { registered: result.registered.length, failed: result.failed };
}

export type RuleRecord = {
  id: string;
  source_store_id: string;
  destination_store_id: string;
  field_toggles: Record<string, boolean>;
  buffer_quantity: number;
  dry_run: boolean;
  active: boolean;
  created_at: string;
};

export async function listRules(supabase: Client): Promise<RuleRecord[]> {
  const { data, error } = await supabase
    .from("sync_rules")
    .select(
      "id, source_store_id, destination_store_id, field_toggles, buffer_quantity, dry_run, active, created_at",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RuleRecord[];
}

export async function saveRule(
  supabase: Client,
  userId: string,
  input: {
    id?: string;
    source_store_id: string;
    destination_store_id: string;
    field_toggles: Record<string, boolean>;
    buffer_quantity: number;
    dry_run: boolean;
    active: boolean;
    conflict_resolution?: string;
  },
) {
  if (input.source_store_id === input.destination_store_id) {
    throw new Error("Kaynak ve hedef mağaza aynı olamaz");
  }
  const row = { ...input, user_id: userId };
  const { error } = input.id
    ? await supabase.from("sync_rules").update(row).eq("id", input.id)
    : await supabase.from("sync_rules").insert(row);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteRule(supabase: Client, id: string) {
  const { error } = await supabase.from("sync_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export type EventRecord = {
  id: string;
  created_at: string;
  store_id: string | null;
  origin_store_id: string | null;
  entity_type: string;
  entity_id: string | null;
  sku: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  source: string;
  status: string;
  dry_run: boolean;
  message: string | null;
};

export async function listEvents(supabase: Client, limit: number): Promise<EventRecord[]> {
  const { data, error } = await supabase
    .from("event_log")
    .select(
      "id, created_at, store_id, origin_store_id, entity_type, entity_id, sku, field, old_value, new_value, source, status, dry_run, message",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 5000));
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRecord[];
}

export async function getDashboard(supabase: Client) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [stores, rules, events, queue] = await Promise.all([
    supabase.from("stores").select("id, status, shopify_domain, label, last_sync_at"),
    supabase.from("sync_rules").select("id, active, dry_run"),
    supabase.from("event_log").select("status, source, created_at").gte("created_at", since),
    supabase.from("sync_queue").select("status"),
  ]);

  const eventRows = events.data ?? [];
  const queueRows = queue.data ?? [];
  const count = (rows: Array<{ status: string }>, status: string) =>
    rows.filter((r) => r.status === status).length;

  return {
    stores: {
      total: stores.data?.length ?? 0,
      active: (stores.data ?? []).filter((s) => s.status === "active").length,
      list: stores.data ?? [],
    },
    rules: {
      total: rules.data?.length ?? 0,
      active: (rules.data ?? []).filter((r) => r.active).length,
      dryRun: (rules.data ?? []).filter((r) => r.dry_run).length,
    },
    last24h: {
      total: eventRows.length,
      applied: count(eventRows as never, "applied"),
      dryRun: count(eventRows as never, "dry_run"),
      failed: count(eventRows as never, "failed"),
      needsReview: count(eventRows as never, "needs_review"),
      loops: count(eventRows as never, "skipped_loop"),
    },
    queue: {
      pending: count(queueRows as never, "pending"),
      processing: count(queueRows as never, "processing"),
      failed: count(queueRows as never, "failed"),
      done: count(queueRows as never, "done"),
    },
  };
}

export async function processMyQueue(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pending } = await supabaseAdmin
    .from("sync_queue")
    .select("id, user_id, store_id, webhook_topic, webhook_id, payload, attempts")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  let processed = 0;
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
      processed++;
    } catch (error) {
      await supabaseAdmin
        .from("sync_queue")
        .update({
          status: "pending",
          last_error: error instanceof Error ? error.message : "hata",
        })
        .eq("id", row.id);
    }
  }
  return { processed };
}

/** Dry-run preview: compares one SKU between the rule's source and destination store. */
export async function previewSku(supabase: Client, ruleId: string, sku: string) {
  const { data: rule } = await supabase
    .from("sync_rules")
    .select("id, source_store_id, destination_store_id, buffer_quantity")
    .eq("id", ruleId)
    .maybeSingle();
  if (!rule) throw new Error("Kural bulunamadı");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: stores } = await supabaseAdmin
    .from("stores")
    .select("id, shopify_domain, api_version, access_token_encrypted")
    .in("id", [rule.source_store_id, rule.destination_store_id]);

  const source = stores?.find((s) => s.id === rule.source_store_id);
  const destination = stores?.find((s) => s.id === rule.destination_store_id);
  if (!source?.access_token_encrypted || !destination?.access_token_encrypted) {
    throw new Error("Her iki mağaza da bağlı olmalı");
  }

  const [sourceVariant, destVariant] = await Promise.all([
    findVariantBySku(
      source.shopify_domain,
      await decryptToken(source.access_token_encrypted),
      source.api_version,
      sku,
    ),
    findVariantBySku(
      destination.shopify_domain,
      await decryptToken(destination.access_token_encrypted),
      destination.api_version,
      sku,
    ),
  ]);

  const target =
    sourceVariant == null ? null : Math.max(0, sourceVariant.available - rule.buffer_quantity);

  return {
    sku,
    sourceDomain: source.shopify_domain,
    destinationDomain: destination.shopify_domain,
    sourceAvailable: sourceVariant?.available ?? null,
    destinationAvailable: destVariant?.available ?? null,
    buffer: rule.buffer_quantity,
    target,
    willChange: target != null && destVariant != null && destVariant.available !== target,
    note:
      sourceVariant == null
        ? "Kaynak mağazada bu SKU bulunamadı"
        : destVariant == null
          ? "Hedef mağazada bu SKU bulunamadı"
          : "Deneme modu — hiçbir şey yazılmadı",
  };
}
