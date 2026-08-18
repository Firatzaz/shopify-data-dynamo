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

// --- Subscriptions & limits ---

export type SubscriptionRecord = {
  id: string;
  plan: string;
  store_limit: number;
  rule_limit: number;
  sync_events_monthly_limit: number;
  features: Record<string, boolean>;
  valid_until: string | null;
  created_at: string;
};

export async function getSubscription(supabase: Client, userId: string): Promise<SubscriptionRecord> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, plan, store_limit, rule_limit, sync_events_monthly_limit, features, valid_until, created_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      id: "",
      plan: "free",
      store_limit: 2,
      rule_limit: 3,
      sync_events_monthly_limit: 500,
      features: { restore: false, approval_queue: true, conflict_resolution: true, charts: true },
      valid_until: null,
      created_at: new Date().toISOString(),
    };
  }
  return {
    ...data,
    features: (data.features as Record<string, boolean>) ?? {},
  } as SubscriptionRecord;
}

async function getUsageCounts(supabase: Client, userId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [stores, rules, events] = await Promise.all([
    supabase.from("stores").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("sync_rules").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", monthStart.toISOString()),
  ]);

  return {
    stores: stores.count ?? 0,
    rules: rules.count ?? 0,
    events: events.count ?? 0,
  };
}

export async function checkLimits(
  supabase: Client,
  userId: string,
  type: "stores" | "rules" | "events",
) {
  const sub = await getSubscription(supabase, userId);
  const counts = await getUsageCounts(supabase, userId);

  const limitMap = {
    stores: { limit: sub.store_limit, current: counts.stores },
    rules: { limit: sub.rule_limit, current: counts.rules },
    events: { limit: sub.sync_events_monthly_limit, current: counts.events },
  };

  const { limit, current } = limitMap[type];
  const allowed = current < limit;

  return {
    allowed,
    current,
    limit,
    plan: sub.plan,
    message: allowed
      ? undefined
      : `${type === "stores" ? "Mağaza" : type === "rules" ? "Kural" : "Aylık olay"} limitine ulaştınız. Mevcut plan: ${sub.plan} (limit: ${limit}). Daha fazlası için yükseltme yapın.`,
  };
}

// Update beginInstall to enforce store limit.
const originalBeginInstall = beginInstall;
export async function beginInstallWithLimit(
  supabase: Client,
  userId: string,
  origin: string,
  input: { domain: string; label?: string; role: string },
) {
  const storeCheck = await checkLimits(supabase, userId, "stores");
  if (!storeCheck.allowed) throw new Error(storeCheck.message ?? "Mağaza limitine ulaştınız");
  return originalBeginInstall(supabase, userId, origin, input);
}

// --- Snapshots ---

export type SnapshotRecord = {
  id: string;
  name: string | null;
  store_id: string | null;
  taken_at: string;
  reason: string | null;
  archive_id: string | null;
};

export async function listSnapshots(supabase: Client, userId: string): Promise<SnapshotRecord[]> {
  const { data, error } = await supabase
    .from("snapshots")
    .select("id, name, store_id, taken_at, reason, archive_id")
    .eq("user_id", userId)
    .order("taken_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SnapshotRecord[];
}

export async function createSnapshot(
  supabase: Client,
  userId: string,
  input: { name?: string; reason?: string },
) {
  const sub = await getSubscription(supabase, userId);
  if (!sub.features?.["restore"]) {
    throw new Error("Snapshot özelliği mevcut planınızda bulunmuyor. Yükseltme yapın.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: stores } = await supabaseAdmin
    .from("stores")
    .select("id, shopify_domain, access_token_encrypted, api_version")
    .eq("user_id", userId)
    .eq("status", "active");

  const fullState: Record<
    string,
    Array<{
      sku: string | null;
      available: number;
      title: string;
      variantId: string;
      inventoryItemId: string;
      locationId: string;
    }>
  > = {};
  const storeIds: string[] = [];

  for (const store of stores ?? []) {
    if (!store.access_token_encrypted) continue;
    const token = await decryptToken(store.access_token_encrypted);
    const items = await fetchAllInventoryState(store.shopify_domain, token, store.api_version);
    fullState[store.id] = items.map((i) => ({
      sku: i.sku,
      available: i.available,
      title: i.title,
      variantId: i.variantId,
      inventoryItemId: i.inventoryItemId,
      locationId: i.locationId,
    }));
    storeIds.push(store.id);
  }

  const allItems = Object.values(fullState).flat();
  const checksum = await checksumJson(fullState);

  const { data: archive, error: archiveError } = await supabaseAdmin
    .from("snapshot_archives")
    .insert({
      user_id: userId,
      source: "manual",
      full_state: fullState,
      checksum,
      is_verified: true,
    })
    .select("id")
    .single();
  if (archiveError) throw new Error(archiveError.message);

  const { data: snapshot, error: snapshotError } = await supabaseAdmin
    .from("snapshots")
    .insert({
      user_id: userId,
      name: input.name || `Yedek ${new Date().toLocaleString("tr-TR")}`,
      reason: input.reason || "Manuel yedekleme",
      archive_id: archive.id,
    })
    .select("id")
    .single();
  if (snapshotError) throw new Error(snapshotError.message);

  return {
    id: snapshot.id,
    archiveId: archive.id,
    stores: storeIds.length,
    items: allItems.length,
  };
}

async function checksumJson(value: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Katman 2 restore: uzlaştırma (reconciliation) algoritması ---
//
// Kesin kural: full_state ASLA olduğu gibi Shopify'a yazılmaz. Snapshot alındıktan
// sonra gerçekleşen meşru olaylar (satış, iade, admin düzenlemesi) korunur;
// yalnızca kullanıcının açıkça iptal ettiği olaylar/aralıklar geri alınır.
// Sistem "hangi olay hatalı" kararını kendi başına asla vermez.

type SnapshotItem = {
  sku: string | null;
  available: number;
  title?: string;
  variantId: string;
  inventoryItemId: string;
  locationId: string;
};

export type RestoreSelection = {
  snapshotId: string;
  /** Kullanıcının iptal etmek istediği olay kaynakları (ör. ["csv_import", "sync_engine"]). */
  excludeSources?: string[];
  /** Kullanıcının iptal etmek istediği zaman aralığı (ISO). */
  excludeFrom?: string;
  excludeTo?: string;
  /** Tek tek iptal edilecek olay kimlikleri. */
  excludeEventIds?: string[];
  /** Sadece bu SKU'lar (boşsa snapshot'taki tüm SKU'lar). */
  skus?: string[];
};

export type RestoreLineItem = {
  storeId: string;
  storeDomain: string;
  sku: string;
  title: string;
  inventoryItemId: string;
  locationId: string;
  base: number;
  preservedDelta: number;
  cancelledDelta: number;
  result: number;
  current: number | null;
  willChange: boolean;
  preservedEvents: Array<{ id: string; source: string; delta: number; created_at: string }>;
  cancelledEvents: Array<{ id: string; source: string; delta: number; created_at: string }>;
};

async function loadSnapshotWithArchive(userId: string, snapshotId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: snapshot } = await supabaseAdmin
    .from("snapshots")
    .select("id, archive_id, user_id, taken_at, name")
    .eq("id", snapshotId)
    .maybeSingle();
  if (!snapshot || snapshot.user_id !== userId || !snapshot.archive_id) {
    throw new Error("Yedek bulunamadı");
  }

  const { data: archive } = await supabaseAdmin
    .from("snapshot_archives")
    .select("full_state, taken_at")
    .eq("id", snapshot.archive_id)
    .maybeSingle();
  if (!archive) throw new Error("Yedek verisi bulunamadı");

  return {
    supabaseAdmin,
    snapshot,
    takenAt: (archive.taken_at as string) ?? (snapshot.taken_at as string),
    fullState: (archive.full_state ?? {}) as Record<string, SnapshotItem[]>,
  };
}

/** Snapshot sonrası oluşan olayları listeler — kullanıcı hangi olayı iptal edeceğini buradan seçer. */
export async function listRestoreCandidateEvents(
  _supabase: Client,
  userId: string,
  snapshotId: string,
) {
  const { supabaseAdmin, takenAt } = await loadSnapshotWithArchive(userId, snapshotId);

  const { data } = await supabaseAdmin
    .from("event_log")
    .select("id, created_at, store_id, sku, source, status, old_value, new_value, message")
    .eq("user_id", userId)
    .eq("entity_type", "inventory")
    .gte("created_at", takenAt)
    .order("created_at", { ascending: true })
    .limit(2000);

  const rows = data ?? [];
  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();

  return { takenAt, sources, events: rows };
}

function deltaOf(row: { old_value: string | null; new_value: string | null }) {
  const from = Number(row.old_value);
  const to = Number(row.new_value);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return to - from;
}

/** Dry-run önizleme: taban + korunan gerçek olaylar − iptal edilen olaylar = sonuç. */
export async function previewRestore(supabase: Client, userId: string, selection: RestoreSelection) {
  const sub = await getSubscription(supabase, userId);
  if (!sub.features?.["restore"]) {
    throw new Error("Snapshot geri yükleme mevcut planınızda bulunmuyor.");
  }

  const { supabaseAdmin, takenAt, fullState } = await loadSnapshotWithArchive(
    userId,
    selection.snapshotId,
  );

  const excludeSources = new Set(selection.excludeSources ?? []);
  const excludeIds = new Set(selection.excludeEventIds ?? []);
  const skuFilter = selection.skus?.length ? new Set(selection.skus) : null;
  const from = selection.excludeFrom ? Date.parse(selection.excludeFrom) : null;
  const to = selection.excludeTo ? Date.parse(selection.excludeTo) : null;

  const { data: eventRows } = await supabaseAdmin
    .from("event_log")
    .select("id, created_at, store_id, sku, source, status, old_value, new_value")
    .eq("user_id", userId)
    .eq("entity_type", "inventory")
    .in("status", ["applied", "no_change"])
    .gte("created_at", takenAt)
    .order("created_at", { ascending: true })
    .limit(5000);

  const items: RestoreLineItem[] = [];

  for (const [storeId, snapshotItems] of Object.entries(fullState)) {
    const { data: store } = await supabaseAdmin
      .from("stores")
      .select("id, shopify_domain, access_token_encrypted, api_version, status")
      .eq("id", storeId)
      .maybeSingle();
    if (!store || store.status === "uninstalled" || !store.access_token_encrypted) continue;
    const token = await decryptToken(store.access_token_encrypted);

    for (const item of snapshotItems) {
      if (!item.sku) continue;
      if (skuFilter && !skuFilter.has(item.sku)) continue;

      const related = (eventRows ?? []).filter(
        (row) => row.store_id === storeId && row.sku === item.sku,
      );
      if (!related.length && !skuFilter) continue;

      const preservedEvents: RestoreLineItem["preservedEvents"] = [];
      const cancelledEvents: RestoreLineItem["cancelledEvents"] = [];

      for (const row of related) {
        const ts = Date.parse(row.created_at as string);
        const inExcludedWindow =
          (from == null || ts >= from) && (to == null || ts <= to) && (from != null || to != null);
        const cancelled =
          excludeIds.has(row.id as string) ||
          excludeSources.has(row.source as string) ||
          inExcludedWindow;

        const entry = {
          id: row.id as string,
          source: row.source as string,
          delta: deltaOf(row),
          created_at: row.created_at as string,
        };
        if (cancelled) cancelledEvents.push(entry);
        else preservedEvents.push(entry);
      }

      const preservedDelta = preservedEvents.reduce((sum, e) => sum + e.delta, 0);
      const cancelledDelta = cancelledEvents.reduce((sum, e) => sum + e.delta, 0);
      const result = Math.max(0, item.available + preservedDelta);

      const variant = await findVariantBySku(
        store.shopify_domain,
        token,
        store.api_version,
        item.sku,
      );

      items.push({
        storeId,
        storeDomain: store.shopify_domain,
        sku: item.sku,
        title: item.title ?? item.sku,
        inventoryItemId: variant?.inventoryItemId ?? item.inventoryItemId,
        locationId: variant?.locationId ?? item.locationId,
        base: item.available,
        preservedDelta,
        cancelledDelta,
        result,
        current: variant?.available ?? null,
        willChange: variant != null && variant.available !== result,
        preservedEvents,
        cancelledEvents,
      });
    }
  }

  return {
    snapshotId: selection.snapshotId,
    takenAt,
    items,
    summary: {
      lines: items.length,
      changing: items.filter((i) => i.willChange).length,
      preservedEvents: items.reduce((s, i) => s + i.preservedEvents.length, 0),
      cancelledEvents: items.reduce((s, i) => s + i.cancelledEvents.length, 0),
    },
  };
}

/**
 * Onaylanmış uzlaştırma sonucunu Shopify'a yazar. `confirm` olmadan yazma yapılmaz.
 * Yazılan değer full_state değil, uzlaştırılmış `result` değeridir.
 */
export async function applyRestore(
  supabase: Client,
  userId: string,
  selection: RestoreSelection & { confirm: boolean },
) {
  if (!selection.confirm) {
    throw new Error("Geri yükleme için önizlemeyi onaylamanız gerekiyor.");
  }

  const preview = await previewRestore(supabase, userId, selection);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let applied = 0;
  let failed = 0;

  for (const line of preview.items) {
    if (!line.willChange) continue;
    const { data: store } = await supabaseAdmin
      .from("stores")
      .select("shopify_domain, access_token_encrypted, api_version")
      .eq("id", line.storeId)
      .maybeSingle();
    if (!store?.access_token_encrypted) continue;
    const token = await decryptToken(store.access_token_encrypted);

    try {
      await setInventoryQuantity({
        domain: store.shopify_domain,
        accessToken: token,
        apiVersion: store.api_version,
        inventoryItemId: line.inventoryItemId,
        locationId: line.locationId,
        quantity: line.result,
        referenceNote: `reconciled restore ${selection.snapshotId}`,
      });
      await supabaseAdmin.from("event_log").insert({
        user_id: userId,
        store_id: line.storeId,
        entity_type: "inventory",
        sku: line.sku,
        field: "inventory_quantity",
        old_value: String(line.current ?? ""),
        new_value: String(line.result),
        source: "restore",
        status: "applied",
        message: `Uzlaştırmalı geri yükleme: taban ${line.base}, korunan ${line.preservedDelta >= 0 ? "+" : ""}${line.preservedDelta}, iptal edilen ${line.cancelledDelta >= 0 ? "+" : ""}${line.cancelledDelta} → ${line.result}`,
        payload: {
          snapshot_id: selection.snapshotId,
          preserved_event_ids: line.preservedEvents.map((e) => e.id),
          cancelled_event_ids: line.cancelledEvents.map((e) => e.id),
        },
      });
      applied++;
    } catch (error) {
      failed++;
      await supabaseAdmin.from("event_log").insert({
        user_id: userId,
        store_id: line.storeId,
        entity_type: "inventory",
        sku: line.sku,
        field: "inventory_quantity",
        new_value: String(line.result),
        source: "restore",
        status: "failed",
        message: error instanceof Error ? error.message : "Geri yükleme hatası",
      });
    }
  }

  return { applied, failed, evaluated: preview.items.length };
}

// --- Approvals ---

export type ApprovalRecord = EventRecord & { proposed_new_value: string | null };

export async function listPendingApprovals(supabase: Client, userId: string): Promise<ApprovalRecord[]> {
  const { data, error } = await supabase
    .from("event_log")
    .select(
      "id, created_at, store_id, origin_store_id, entity_type, entity_id, sku, field, old_value, new_value, source, status, dry_run, message",
    )
    .eq("user_id", userId)
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, proposed_new_value: row.new_value })) as ApprovalRecord[];
}

export async function approveEvent(supabase: Client, userId: string, eventId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: event } = await supabaseAdmin
    .from("event_log")
    .select("*")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!event) throw new Error("Onay kaydı bulunamadı");

  if (event.entity_type === "inventory" && event.store_id && event.sku && event.new_value != null) {
    const sku = event.sku;
    const { data: store } = await supabaseAdmin
      .from("stores")
      .select("id, shopify_domain, access_token_encrypted, api_version")
      .eq("id", event.store_id)
      .maybeSingle();
    if (store?.access_token_encrypted) {
      const token = await decryptToken(store.access_token_encrypted);
      const variant = await findVariantBySku(store.shopify_domain, token, store.api_version, sku);
      if (variant) {
        await setInventoryQuantity({
          domain: store.shopify_domain,
          accessToken: token,
          apiVersion: store.api_version,
          inventoryItemId: variant.inventoryItemId,
          locationId: variant.locationId,
          quantity: Number(event.new_value),
          referenceNote: `approved from event ${eventId}`,
        });
      }
    }
  }

  await supabaseAdmin.from("event_log").insert({
    user_id: userId,
    store_id: event.store_id,
    origin_store_id: event.origin_store_id,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    sku: event.sku,
    field: event.field,
    old_value: event.old_value,
    new_value: event.new_value,
    source: "approval",
    status: "applied",
    message: `Onaylandı ve uygulandı (olay: ${eventId})`,
  });

  return { ok: true };
}

export async function rejectEvent(supabase: Client, userId: string, eventId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: event } = await supabaseAdmin
    .from("event_log")
    .select("*")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!event) throw new Error("Onay kaydı bulunamadı");

  await supabaseAdmin.from("event_log").insert({
    user_id: userId,
    store_id: event.store_id,
    origin_store_id: event.origin_store_id,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    sku: event.sku,
    field: event.field,
    old_value: event.old_value,
    new_value: event.new_value,
    source: "approval",
    status: "rejected",
    message: `Reddedildi (olay: ${eventId})`,
  });

  return { ok: true };
}
