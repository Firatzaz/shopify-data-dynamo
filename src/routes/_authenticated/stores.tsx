import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import {
  fetchStores,
  reRegisterWebhooks,
  removeStore,
  startInstall,
  testStoreConnection,
} from "@/lib/app.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/stores")({
  head: () => ({
    meta: [
      { title: "Mağazalar — Stok Senkron" },
      {
        name: "description",
        content: "Shopify mağazalarınızı bağlayın, bağlantıyı test edin ve webhook'ları yenileyin.",
      },
      { property: "og:title", content: "Mağazalar — Stok Senkron" },
      { property: "og:description", content: "Shopify mağaza bağlantılarını yönetin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StoresPage,
});

function StoresPage() {
  const listStores = useServerFn(fetchStores);
  const install = useServerFn(startInstall);
  const test = useServerFn(testStoreConnection);
  const webhooks = useServerFn(reRegisterWebhooks);
  const drop = useServerFn(removeStore);
  const queryClient = useQueryClient();

  const [domain, setDomain] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"primary" | "secondary">("primary");

  const { data: stores, isLoading } = useQuery({
    queryKey: ["stores"],
    queryFn: () => listStores(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["stores"] });
  const fail = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : "İşlem başarısız");

  const connect = useMutation({
    mutationFn: () => install({ data: { domain, label: label || undefined, role } }),
    onSuccess: (result) => {
      window.location.href = result.authorizeUrl;
    },
    onError: fail,
  });

  const testMutation = useMutation({
    mutationFn: (storeId: string) => test({ data: { storeId } }),
    onSuccess: (result) =>
      result.ok ? toast.success(result.message) : toast.error(result.message),
    onError: fail,
  });

  const webhookMutation = useMutation({
    mutationFn: (storeId: string) => webhooks({ data: { storeId } }),
    onSuccess: (result) => toast.success(`${result.registered} webhook kaydedildi`),
    onError: fail,
  });

  const removeMutation = useMutation({
    mutationFn: (storeId: string) => drop({ data: { storeId } }),
    onSuccess: () => {
      toast.success("Mağaza kaldırıldı");
      refresh();
    },
    onError: fail,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mağazalar</h1>
        <p className="text-sm text-muted-foreground">
          Shopify kurulumunu başlatın; erişim izni Shopify üzerinden alınır.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Yeni mağaza bağla</CardTitle>
          <CardDescription>Mağaza adresi örn. magazam.myshopify.com</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              connect.mutate();
            }}
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="domain">Mağaza adresi</Label>
              <Input
                id="domain"
                required
                placeholder="magazam.myshopify.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label">Etiket</Label>
              <Input
                id="label"
                placeholder="Ana mağaza"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Kaynak (ana)</SelectItem>
                  <SelectItem value="secondary">Hedef (ikincil)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={connect.isPending} className="sm:col-span-4 sm:w-fit">
              Shopify ile bağlan
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {stores?.length === 0 && (
          <p className="text-sm text-muted-foreground">Henüz bağlı mağaza yok.</p>
        )}
        {stores?.map((store) => (
          <div
            key={store.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{store.label ?? store.shopify_domain}</p>
              <p className="truncate text-xs text-muted-foreground">
                {store.shopify_domain} · {store.role === "primary" ? "kaynak" : "hedef"}
                {store.last_sync_at
                  ? ` · son senkron ${new Date(store.last_sync_at).toLocaleString("tr-TR")}`
                  : ""}
              </p>
            </div>
            <Badge variant={store.status === "active" ? "default" : "secondary"}>
              {store.status}
            </Badge>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => testMutation.mutate(store.id)}
                disabled={testMutation.isPending}
              >
                Test et
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => webhookMutation.mutate(store.id)}
                disabled={webhookMutation.isPending}
              >
                Webhook yenile
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeMutation.mutate(store.id)}
                disabled={removeMutation.isPending}
              >
                Kaldır
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
