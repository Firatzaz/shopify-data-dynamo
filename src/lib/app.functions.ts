import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function originFromRequest() {
  const request = getRequest();
  return new URL(request.url).origin;
}

export const fetchDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getDashboard } = await import("./app.server");
    return getDashboard(context.supabase as never);
  });

export const fetchStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listStores } = await import("./app.server");
    return listStores(context.supabase as never);
  });

export const startInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        domain: z.string().min(3),
        label: z.string().optional(),
        role: z.enum(["primary", "secondary"]).default("secondary"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { beginInstall } = await import("./app.server");
    return beginInstall(context.supabase as never, context.userId, originFromRequest(), data);
  });

export const removeStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { deleteStore } = await import("./app.server");
    return deleteStore(context.supabase as never, data.storeId);
  });

export const testStoreConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { testStore } = await import("./app.server");
    return testStore(context.supabase as never, data.storeId);
  });

export const reRegisterWebhooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { refreshWebhooks } = await import("./app.server");
    return refreshWebhooks(context.supabase as never, data.storeId, originFromRequest());
  });

export const fetchRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listRules } = await import("./app.server");
    return listRules(context.supabase as never);
  });

export const upsertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid().optional(),
        source_store_id: z.string().uuid(),
        destination_store_id: z.string().uuid(),
        field_toggles: z.record(z.string(), z.boolean()),
        buffer_quantity: z.number().int().min(0).max(100000),
        dry_run: z.boolean(),
        active: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { saveRule } = await import("./app.server");
    return saveRule(context.supabase as never, context.userId, data);
  });

export const removeRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { deleteRule } = await import("./app.server");
    return deleteRule(context.supabase as never, data.id);
  });

export const fetchEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ limit: z.number().int().default(500) }).parse(data))
  .handler(async ({ data, context }) => {
    const { listEvents } = await import("./app.server");
    return listEvents(context.supabase as never, data.limit);
  });

export const runQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processMyQueue } = await import("./app.server");
    return processMyQueue(context.userId);
  });

export const previewRuleSku = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ ruleId: z.string().uuid(), sku: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { previewSku } = await import("./app.server");
    return previewSku(context.supabase as never, data.ruleId, data.sku);
  });
