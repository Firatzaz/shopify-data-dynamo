// Server-only queue processor. All heavy Shopify work happens here, never in the webhook receiver.
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptToken } from "./crypto.server";
import {
  findVariantBySku,
  lookupSkuByInventoryItem,
  setInventoryQuantity,
} from "./shopify.server";

type Admin = SupabaseClient<any, "public", any>;

type StoreRow = {
  id: string;
  user_id: string;
  shopify_domain: string;
  access_token_encrypted: string | null;
  api_version: string;
  status: string;
};

type RuleRow = {
  id: string;
  source_store_id: string;
  destination_store_id: string;
  field_toggles: Record<string, boolean>;
  buffer_quantity: number;
  dry_run: boolean;
  active: boolean;
  conflict_resolution: string;
};

export type QueueRow = {
  id: string;
  user_id: string | null;
  store_id: string | null;
  webhook_topic: string;
  webhook_id: string | null;
  payload: Record<string, any>;
};

export type ProcessOutcome = {
  queueId: string;
  status: "done" | "failed" | "skipped";
  events: number;
  note: string;
};

async function logEvent(
  admin: Admin,
  row: {
    user_id: string;
    store_id: string | null;
    origin_store_id: string | null;
    webhook_id?: string | null;
    entity_type: string;
    entity_id?: string | null;
    sku?: string | null;
    field?: string | null;
    old_value?: string | null;
    new_value?: string | null;
    source: string;
    status: string;
    dry_run?: boolean;
    message?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  const { error } = await admin.from("event_log").insert(row);
  // Duplicate webhook ids are expected (idempotency guard), never fatal.
  if (error && !error.message.includes("duplicate key")) throw new Error(error.message);
}

/** Loop detection: did we ourselves just write this exact value into this store? */
async function isEchoOfOurOwnWrite(
  admin: Admin,
  args: { storeId: string; sku: string; value: string },
): Promise<boolean> {
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("event_log")
    .select("id")
    .eq("store_id", args.storeId)
    .eq("sku", args.sku)
    .eq("source", "sync_engine")
    .eq("new_value", args.value)
    .gte("created_at", since)
    .limit(1);
  return Boolean(data?.length);
}

export async function processQueueItem(admin: Admin, item: QueueRow): Promise<ProcessOutcome> {
  if (!item.store_id) {
    return { queueId: item.id, status: "skipped", events: 0, note: "Bilinmeyen mağaza" };
  }

  const { data: sourceStore } = await admin
    .from("stores")
    .select("id, user_id, shopify_domain, access_token_encrypted, api_version, status")
    .eq("id", item.store_id)
    .maybeSingle<StoreRow>();

  if (!sourceStore) {
    return { queueId: item.id, status: "skipped", events: 0, note: "Mağaza bulunamadı" };
  }

  const userId = sourceStore.user_id;

  if (item.webhook_topic === "app/uninstalled") {
    await admin.from("stores").update({ status: "uninstalled" }).eq("id", sourceStore.id);
    await admin
      .from("sync_queue")
      .update({ status: "cancelled", processed_at: new Date().toISOString() })
      .eq("store_id", sourceStore.id)
      .eq("status", "pending");
    await logEvent(admin, {
      user_id: userId,
      store_id: sourceStore.id,
      origin_store_id: sourceStore.id,
      webhook_id: item.webhook_id,
      entity_type: "app",
      source: "webhook",
      status: "applied",
      message: "Uygulama kaldırıldı, mağaza pasifleştirildi",
    });
    return { queueId: item.id, status: "done", events: 1, note: "Mağaza pasifleştirildi" };
  }

  // Non-inventory topics are recorded for the audit trail; inventory is the sync trigger.
  if (item.webhook_topic !== "inventory_levels/update") {
    const entityType = item.webhook_topic.split("/")[0] ?? "event";
    await logEvent(admin, {
      user_id: userId,
      store_id: sourceStore.id,
      origin_store_id: sourceStore.id,
      webhook_id: item.webhook_id,
      entity_type: entityType,
      entity_id: item.payload?.["id"] ? String(item.payload["id"]) : null,
      field: item.webhook_topic,
      source: "webhook",
      status: item.webhook_topic === "products/delete" ? "needs_review" : "observed",
      message:
        item.webhook_topic === "products/delete"
          ? "Kaynak mağazada ürün silindi — karşı mağazada otomatik silme yapılmadı, onayınız gerekiyor"
          : `Webhook alındı: ${item.webhook_topic}`,
      payload: item.payload,
    });
    return { queueId: item.id, status: "done", events: 1, note: item.webhook_topic };
  }

  const inventoryItemId = item.payload?.["inventory_item_id"];
  const available = item.payload?.["available"];
  if (inventoryItemId == null || available == null) {
    return { queueId: item.id, status: "skipped", events: 0, note: "Eksik stok verisi" };
  }

  const sourceToken = sourceStore.access_token_encrypted
    ? await decryptToken(sourceStore.access_token_encrypted)
    : null;
  if (!sourceToken) {
    return { queueId: item.id, status: "failed", events: 0, note: "Kaynak mağaza tokenı yok" };
  }

  const { sku } = await lookupSkuByInventoryItem(
    sourceStore.shopify_domain,
    sourceToken,
    sourceStore.api_version,
    inventoryItemId,
  );

  if (!sku) {
    await logEvent(admin, {
      user_id: userId,
      store_id: sourceStore.id,
      origin_store_id: sourceStore.id,
      webhook_id: item.webhook_id,
      entity_type: "inventory",
      entity_id: String(inventoryItemId),
      field: "inventory_quantity",
      new_value: String(available),
      source: "webhook",
      status: "needs_review",
      message: "SKU boş — senkronizasyon atlandı (SKU tutarlılığı gerekli)",
      payload: item.payload,
    });
    return { queueId: item.id, status: "done", events: 1, note: "SKU yok" };
  }

  // Loop detection before anything else.
  if (
    await isEchoOfOurOwnWrite(admin, {
      storeId: sourceStore.id,
      sku,
      value: String(available),
    })
  ) {
    await logEvent(admin, {
      user_id: userId,
      store_id: sourceStore.id,
      origin_store_id: sourceStore.id,
      webhook_id: item.webhook_id,
      entity_type: "inventory",
      sku,
      field: "inventory_quantity",
      new_value: String(available),
      source: "loop_guard",
      status: "skipped_loop",
      message: "Kendi yazdığımız değerin yankısı — döngü engellendi",
    });
    return { queueId: item.id, status: "done", events: 1, note: "Döngü engellendi" };
  }

  const { data: rules } = await admin
    .from("sync_rules")
    .select(
      "id, source_store_id, destination_store_id, field_toggles, buffer_quantity, dry_run, active",
    )
    .eq("source_store_id", sourceStore.id)
    .eq("active", true)
    .returns<RuleRow[]>();

  if (!rules?.length) {
    return { queueId: item.id, status: "done", events: 0, note: "Aktif kural yok" };
  }

  let events = 0;

  for (const rule of rules) {
    if (rule.field_toggles?.["inventory"] === false) continue;

    const { data: destStore } = await admin
      .from("stores")
      .select("id, user_id, shopify_domain, access_token_encrypted, api_version, status")
      .eq("id", rule.destination_store_id)
      .maybeSingle<StoreRow>();

    if (!destStore || destStore.status === "uninstalled" || !destStore.access_token_encrypted) {
      await logEvent(admin, {
        user_id: userId,
        store_id: rule.destination_store_id,
        origin_store_id: sourceStore.id,
        entity_type: "inventory",
        sku,
        field: "inventory_quantity",
        new_value: String(available),
        source: "sync_engine",
        status: "failed",
        message: "Hedef mağaza bağlı değil",
      });
      events++;
      continue;
    }

    const destToken = await decryptToken(destStore.access_token_encrypted);
    const target = Math.max(0, Number(available) - (rule.buffer_quantity ?? 0));

    const variant = await findVariantBySku(
      destStore.shopify_domain,
      destToken,
      destStore.api_version,
      sku,
    );

    if (!variant) {
      await logEvent(admin, {
        user_id: userId,
        store_id: destStore.id,
        origin_store_id: sourceStore.id,
        webhook_id: item.webhook_id,
        entity_type: "inventory",
        sku,
        field: "inventory_quantity",
        new_value: String(target),
        source: "sync_engine",
        status: "needs_review",
        message: "Hedef mağazada bu SKU bulunamadı",
      });
      events++;
      continue;
    }

    if (variant.available === target) {
      events++;
      await logEvent(admin, {
        user_id: userId,
        store_id: destStore.id,
        origin_store_id: sourceStore.id,
        webhook_id: item.webhook_id,
        entity_type: "inventory",
        entity_id: variant.variantId,
        sku,
        field: "inventory_quantity",
        old_value: String(variant.available),
        new_value: String(target),
        source: "sync_engine",
        status: "no_change",
        message: "Hedef değer zaten güncel",
      });
      continue;
    }

    if (rule.dry_run) {
      await logEvent(admin, {
        user_id: userId,
        store_id: destStore.id,
        origin_store_id: sourceStore.id,
        webhook_id: item.webhook_id,
        entity_type: "inventory",
        entity_id: variant.variantId,
        sku,
        field: "inventory_quantity",
        old_value: String(variant.available),
        new_value: String(target),
        source: "sync_engine",
        status: "dry_run",
        dry_run: true,
        message: `Deneme modu: ${variant.title} ${variant.available} → ${target} (yazılmadı)`,
      });
      events++;
      continue;
    }

    try {
      await setInventoryQuantity({
        domain: destStore.shopify_domain,
        accessToken: destToken,
        apiVersion: destStore.api_version,
        inventoryItemId: variant.inventoryItemId,
        locationId: variant.locationId,
        quantity: target,
        referenceNote: `sync from ${sourceStore.shopify_domain}`,
      });
      await logEvent(admin, {
        user_id: userId,
        store_id: destStore.id,
        origin_store_id: sourceStore.id,
        webhook_id: item.webhook_id,
        entity_type: "inventory",
        entity_id: variant.variantId,
        sku,
        field: "inventory_quantity",
        old_value: String(variant.available),
        new_value: String(target),
        source: "sync_engine",
        status: "applied",
        message: `${sourceStore.shopify_domain} → ${destStore.shopify_domain}`,
      });
      await admin
        .from("stores")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", destStore.id);
      events++;
    } catch (error) {
      await logEvent(admin, {
        user_id: userId,
        store_id: destStore.id,
        origin_store_id: sourceStore.id,
        webhook_id: item.webhook_id,
        entity_type: "inventory",
        sku,
        field: "inventory_quantity",
        old_value: String(variant.available),
        new_value: String(target),
        source: "sync_engine",
        status: "failed",
        message: error instanceof Error ? error.message : "Bilinmeyen hata",
      });
      events++;
    }
  }

  return { queueId: item.id, status: "done", events, note: `${events} olay` };
}
