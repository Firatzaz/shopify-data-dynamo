import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { fetchDashboard, runQueueNow } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Panel — Stok Senkron" },
      { name: "description", content: "Mağaza, kural ve senkron olaylarının 24 saatlik özeti." },
      { property: "og:title", content: "Panel — Stok Senkron" },
      { property: "og:description", content: "Senkron durumunuzun canlı özeti." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function DashboardPage() {
  const getDashboard = useServerFn(fetchDashboard);
  const processQueue = useServerFn(runQueueNow);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    refetchInterval: 30000,
  });

  const run = useMutation({
    mutationFn: () => processQueue(),
    onSuccess: (result) => {
      toast.success(`${result.processed} kuyruk kaydı işlendi`);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "İşlem başarısız"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Veri alınamadı"}
      </p>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Panel</h1>
          <p className="text-sm text-muted-foreground">Son 24 saatlik senkron durumu</p>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          Kuyruğu şimdi işle
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bağlı mağaza" value={`${data.stores.active}/${data.stores.total}`} />
        <Stat label="Aktif kural" value={`${data.rules.active}/${data.rules.total}`} />
        <Stat label="24s olay" value={data.last24h.total} />
        <Stat label="Kuyrukta bekleyen" value={data.queue.pending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Olay dağılımı (24s)</CardTitle>
            <CardDescription>Uygulanan, deneme ve hata durumları</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>Uygulandı: <strong>{data.last24h.applied}</strong></div>
            <div>Deneme modu: <strong>{data.last24h.dryRun}</strong></div>
            <div>Hata: <strong>{data.last24h.failed}</strong></div>
            <div>İnceleme gerek: <strong>{data.last24h.needsReview}</strong></div>
            <div>Döngü engellendi: <strong>{data.last24h.loops}</strong></div>
            <div>Kuyruk hatası: <strong>{data.queue.failed}</strong></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mağazalar</CardTitle>
            <CardDescription>Bağlantı durumu ve son senkron</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.stores.list.length === 0 ? (
              <p className="text-muted-foreground">
                Henüz mağaza yok.{" "}
                <Link to="/stores" className="underline">
                  Mağaza bağla
                </Link>
              </p>
            ) : (
              data.stores.list.map((store) => (
                <div key={store.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{store.label ?? store.shopify_domain}</span>
                  <Badge variant={store.status === "active" ? "default" : "secondary"}>
                    {store.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
