import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";

import { fetchEvents } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Denetim Logları — Stok Senkron" },
      {
        name: "description",
        content: "Tüm senkron olaylarının değiştirilemez denetim kaydı: SKU, alan, eski ve yeni değer.",
      },
      { property: "og:title", content: "Denetim Logları — Stok Senkron" },
      { property: "og:description", content: "Her senkron hareketinin izlenebilir kaydı." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LogsPage,
});

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  applied: "default",
  skipped: "secondary",
  failed: "destructive",
  dry_run: "outline",
};

function LogsPage() {
  const getEvents = useServerFn(fetchEvents);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["events"],
    queryFn: () => getEvents({ data: { limit: 1000 } }),
    refetchInterval: 60000,
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!term) return true;
      return [row.sku, row.entity_id, row.field, row.source, row.message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [data, search, status]);

  const exportCsv = () => {
    const header = [
      "zaman",
      "kaynak",
      "durum",
      "sku",
      "alan",
      "eski",
      "yeni",
      "kuru_calisma",
      "mesaj",
    ];
    const body = rows.map((r) =>
      [
        r.created_at,
        r.source,
        r.status,
        r.sku ?? "",
        r.field ?? "",
        r.old_value ?? "",
        r.new_value ?? "",
        r.dry_run ? "evet" : "hayır",
        (r.message ?? "").replace(/[\r\n]+/g, " "),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `senkron-loglari-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Denetim Logları</h1>
        <p className="text-sm text-muted-foreground">
          Değiştirilemez kayıt: her satır bir senkron kararını ve sonucunu gösterir.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="SKU, alan, kaynak veya mesaj ara"
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Tüm durumlar</option>
          <option value="applied">Uygulandı</option>
          <option value="skipped">Atlandı</option>
          <option value="failed">Başarısız</option>
          <option value="dry_run">Kuru çalışma</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          Yenile
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          CSV indir
        </Button>
        <span className="text-xs text-muted-foreground">{rows.length} kayıt</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Loglar alınamadı"}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Henüz log kaydı yok. Mağaza bağlayıp bir kural etkinleştirdiğinizde olaylar burada
          görünecek.
        </p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/95 backdrop-blur">
              <tr className="text-left">
                {["Zaman", "Kaynak", "Durum", "SKU", "Alan", "Eski", "Yeni", "Mesaj"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-xs font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top hover:bg-accent/40">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString("tr-TR")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.source}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusTone[row.status] ?? "secondary"}>{row.status}</Badge>
                    {row.dry_run ? (
                      <Badge variant="outline" className="ml-1">
                        kuru
                      </Badge>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.sku ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.field ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.old_value ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.new_value ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{row.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
