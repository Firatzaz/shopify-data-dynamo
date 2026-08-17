import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchDashboard, fetchPendingApprovals, fetchSubscription, runQueueNow } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useLocalStorage } from "@/hooks/use-local-storage";

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
  const getSubscription = useServerFn(fetchSubscription);
  const getPendingApprovals = useServerFn(fetchPendingApprovals);
  const processQueue = useServerFn(runQueueNow);
  const queryClient = useQueryClient();
  const [onboarding, setOnboarding] = useLocalStorage("stoksenkron.onboarding", true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    refetchInterval: 30000,
  });

  const { data: sub } = useQuery({
    queryKey: ["subscription"],
    queryFn: () => getSubscription(),
  });

  const { data: approvals } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: () => getPendingApprovals(),
    refetchInterval: 15000,
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

  const eventChart = [
    { name: "Uygulandı", value: data.last24h.applied },
    { name: "Deneme", value: data.last24h.dryRun },
    { name: "Hata", value: data.last24h.failed },
    { name: "İnceleme", value: data.last24h.needsReview },
    { name: "Döngü", value: data.last24h.loops },
  ];

  const storePct = sub ? Math.min(100, Math.round((data.stores.total / sub.store_limit) * 100)) : 0;
  const rulePct = sub ? Math.min(100, Math.round((data.rules.total / sub.rule_limit) * 100)) : 0;
  const eventPct = sub ? Math.min(100, Math.round((data.last24h.total / sub.sync_events_monthly_limit) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Panel</h1>
          <p className="text-sm text-muted-foreground">Son 24 saatlik senkron durumu</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/snapshots">Yedekler</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/approvals">
              Onaylar {approvals && approvals.length > 0 && `(${approvals.length})`}
            </Link>
          </Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            Kuyruğu şimdi işle
          </Button>
        </div>
      </div>

      {onboarding && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Başlangıç rehberi</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setOnboarding(false)}>
                Gizle
              </Button>
            </div>
            <CardDescription>Stok Senkron'u kullanmaya başlamak için 3 adım</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              <li className={data.stores.total > 0 ? "text-muted-foreground line-through" : ""}>
                1. <Link to="/stores" className="underline">Mağazalar</Link> sayfasından en az iki Shopify mağazası bağlayın.
              </li>
              <li className={data.rules.total > 0 ? "text-muted-foreground line-through" : ""}>
                2. <Link to="/rules" className="underline">Kurallar</Link> sayfasında kaynak → hedef senkron kuralı oluşturun.
              </li>
              <li>
                3. Shopify'da stok değişikliği yapın veya <strong>Kuyruğu şimdi işle</strong> ile test edin.
              </li>
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bağlı mağaza" value={`${data.stores.active}/${data.stores.total}`} />
        <Stat label="Aktif kural" value={`${data.rules.active}/${data.rules.total}`} />
        <Stat label="24s olay" value={data.last24h.total} />
        <Stat label="Kuyrukta bekleyen" value={data.queue.pending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Olay dağılımı (24s)</CardTitle>
            <CardDescription>Uygulanan, deneme ve hata durumları</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan kullanımı</CardTitle>
            <CardDescription>
              {sub ? `Mevcut plan: ${sub.plan.toUpperCase()}` : "Plan bilgisi yükleniyor…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Mağazalar</span>
                <span className="text-muted-foreground">
                  {data.stores.total}/{sub?.store_limit ?? "-"}
                </span>
              </div>
              <Progress value={storePct} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Kurallar</span>
                <span className="text-muted-foreground">
                  {data.rules.total}/{sub?.rule_limit ?? "-"}
                </span>
              </div>
              <Progress value={rulePct} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Aylık olay</span>
                <span className="text-muted-foreground">
                  {data.last24h.total}/{sub?.sync_events_monthly_limit ?? "-"}
                </span>
              </div>
              <Progress value={eventPct} />
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {Object.entries(sub?.features ?? {}).map(([key, enabled]) => (
                <Badge key={key} variant={enabled ? "default" : "outline"}>
                  {key}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

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
  );
}
