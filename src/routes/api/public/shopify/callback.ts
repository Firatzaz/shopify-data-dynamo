import { createFileRoute } from "@tanstack/react-router";

import { encryptToken } from "@/lib/crypto.server";
import {
  exchangeAccessToken,
  fetchShopInfo,
  isValidShopDomain,
  registerWebhooks,
  verifyOAuthHmac,
} from "@/lib/shopify.server";

function redirectTo(origin: string, status: string, detail?: string) {
  const url = new URL("/stores", origin);
  url.searchParams.set("install", status);
  if (detail) url.searchParams.set("detail", detail);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

export const Route = createFileRoute("/api/public/shopify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const shop = url.searchParams.get("shop") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";

        if (!isValidShopDomain(shop) || !code || !state) {
          return redirectTo(url.origin, "error", "Eksik veya geçersiz kurulum parametreleri");
        }
        if (!(await verifyOAuthHmac(url))) {
          return new Response("Invalid HMAC", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: pending } = await supabaseAdmin
          .from("oauth_states")
          .select("state, user_id, shopify_domain, label, role")
          .eq("state", state)
          .maybeSingle();

        if (!pending || pending.shopify_domain !== shop) {
          return redirectTo(url.origin, "error", "Kurulum oturumu doğrulanamadı");
        }
        await supabaseAdmin.from("oauth_states").delete().eq("state", state);

        try {
          const { access_token, scope } = await exchangeAccessToken(shop, code);
          const shopInfo = await fetchShopInfo(shop, access_token);
          const encrypted = await encryptToken(access_token);

          const { data: store, error } = await supabaseAdmin
            .from("stores")
            .upsert(
              {
                user_id: pending.user_id,
                shopify_domain: shop,
                label: pending.label || shopInfo.name,
                access_token_encrypted: encrypted,
                scope,
                role: pending.role,
                status: "active",
                installed_at: new Date().toISOString(),
              },
              { onConflict: "user_id,shopify_domain" },
            )
            .select("id")
            .single();

          if (error) throw new Error(error.message);

          const callbackUrl = `${url.origin}/api/public/shopify/webhooks`;
          const result = await registerWebhooks(shop, access_token, callbackUrl);

          await supabaseAdmin.from("event_log").insert({
            user_id: pending.user_id,
            store_id: store.id,
            origin_store_id: store.id,
            entity_type: "store",
            field: "install",
            new_value: "active",
            source: "oauth",
            status: result.failed.length ? "needs_review" : "applied",
            message: `Mağaza bağlandı (${result.registered.length} webhook kayıtlı${
              result.failed.length ? `, ${result.failed.length} başarısız` : ""
            })`,
          });

          return redirectTo(url.origin, "success", shopInfo.name);
        } catch (error) {
          console.error("Shopify install failed", error);
          return redirectTo(
            url.origin,
            "error",
            error instanceof Error ? error.message : "Kurulum tamamlanamadı",
          );
        }
      },
    },
  },
});
