import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import {
  fetchRules,
  fetchStores,
  previewRuleSku,
  removeRule,
  upsertRule,
} from "@/lib/app.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/rules")({
  head: () => ({
    meta: [
      { title: "Kurallar — Stok Senkron" },
      {
        name: "description",
        content: "Kaynak ve hedef mağaza arasında stok senkron kurallarını, tampon ve deneme modunu yönetin.",
      },
      { property: "og:title", content: "Kurallar — Stok Senkron" },
      { property: "og:description", content: "Senkron kurallarını tanımlayın ve test edin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RulesPage,
});

const FIELDS = [
  { key: "inventory", label: "Stok" },
  { key: "price", label: "Fiyat" },
  { key: "title", label: "Başlık" },
  { key: "description", label: "Açıklama" },
  { key: "images", label: "Görseller" },
] as const;

function RulesPage() {
  const listRules = useServerFn(fetchRules);
  const listStores = useServerFn(fetchStores);
  const save = useServerFn(upsertRule);
  const drop = useServerFn(removeRule);
  const preview = useServerFn(previewRuleSku);
  const queryClient = useQueryClient();

  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [buffer, setBuffer] = useState(0);
  const [dryRun, setDryRun] = useState(true);
  const [toggles, setToggles] = useState<Record<string, boolean>>({ inventory: true });
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({});

  const { data: stores } = useQuery({ queryKey: ["stores"], queryFn: () => listStores() });
  const { data: rules, isLoading } = useQuery({ queryKey: ["rules"], queryFn: () => listRules() });

  const fail = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : "İşlem başarısız");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rules"] });
  const nameOf = (id: string) =>
    stores?.find((s) => s.id === id)?.label ??
    stores?.find((s) => s.id === id)?.shopify_domain ??
    id;

  const create = useMutation({
    mutationFn: () =>
      save({
        data: {
          source_store_id: source,
          destination_store_id: destination,
          field_toggles: toggles,
          buffer_quantity: buffer,
          dry_run: dryRun,
          active: true,
        },
      }),
    onSuccess: () => {
      toast.success("Kural kaydedildi");
      refresh();
    },
    onError: fail,
  });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof save>[0]) => save(input),
    onSuccess: refresh,
    onError: fail,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => drop({ data: { id } }),
    onSuccess: () => {
      toast.success("Kural silindi");
      refresh();
    },
    onError: fail,
  });

  const previewMutation = useMutation({
    mutationFn: (input: { ruleId: string; sku: string }) => preview({ data: input }),
    onSuccess: (result) =>
      toast.message(`SKU ${result.sku}`, {
        description: `${result.sourceDomain}: ${result.sourceAvailable ?? "-"} → ${result.destinationDomain}: ${result.destinationAvailable ?? "-"} (hedef ${result.target ?? "-"}, tampon ${result.buffer}) · ${result.note}`,
      }),
    onError: fail,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Senkron kuralları</h1>
        <p className="text-sm text-muted-foreground">
          Kaynak mağazadan hedef mağazaya hangi alanların aktarılacağını belirleyin.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Yeni kural</CardTitle>
          <CardDescription>Deneme modunda hiçbir veri yazılmaz, sadece loglanır.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Kaynak mağaza</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {(stores ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.label ?? store.shopify_domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Hedef mağaza</Label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger>
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {(stores ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.label ?? store.shopify_domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="buffer">Tampon stok</Label>
              <Input
                id="buffer"
                type="number"
                min={0}
                value={buffer}
                onChange={(e) => setBuffer(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-2 text-sm">
                <Switch
                  checked={Boolean(toggles[field.key])}
                  onCheckedChange={(checked) =>
                    setToggles((prev) => ({ ...prev, [field.key]: checked }))
                  }
                />
                {field.label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
              Deneme modu
            </label>
          </div>

          <Button
            disabled={!source || !destination || create.isPending}
            onClick={() => create.mutate()}
          >
            Kuralı kaydet
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {rules?.length === 0 && <p className="text-sm text-muted-foreground">Henüz kural yok.</p>}
        {rules?.map((rule) => (
          <div key={rule.id} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 truncate font-medium">
                {nameOf(rule.source_store_id)} → {nameOf(rule.destination_store_id)}
              </p>
              <Badge variant={rule.dry_run ? "secondary" : "default"}>
                {rule.dry_run ? "deneme" : "canlı"}
              </Badge>
              <Badge variant={rule.active ? "default" : "outline"}>
                {rule.active ? "aktif" : "kapalı"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Tampon: {rule.buffer_quantity} · Alanlar:{" "}
              {FIELDS.filter((f) => rule.field_toggles?.[f.key])
                .map((f) => f.label)
                .join(", ") || "yok"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40"
                placeholder="SKU ile test"
                value={skuInputs[rule.id] ?? ""}
                onChange={(e) =>
                  setSkuInputs((prev) => ({ ...prev, [rule.id]: e.target.value }))
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!skuInputs[rule.id] || previewMutation.isPending}
                onClick={() =>
                  previewMutation.mutate({ ruleId: rule.id, sku: skuInputs[rule.id]! })
                }
              >
                Önizle
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  update.mutate({
                    data: {
                      id: rule.id,
                      source_store_id: rule.source_store_id,
                      destination_store_id: rule.destination_store_id,
                      field_toggles: rule.field_toggles ?? {},
                      buffer_quantity: rule.buffer_quantity,
                      dry_run: !rule.dry_run,
                      active: rule.active,
                    },
                  })
                }
              >
                {rule.dry_run ? "Canlıya al" : "Denemeye al"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  update.mutate({
                    data: {
                      id: rule.id,
                      source_store_id: rule.source_store_id,
                      destination_store_id: rule.destination_store_id,
                      field_toggles: rule.field_toggles ?? {},
                      buffer_quantity: rule.buffer_quantity,
                      dry_run: rule.dry_run,
                      active: !rule.active,
                    },
                  })
                }
              >
                {rule.active ? "Durdur" : "Etkinleştir"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(rule.id)}>
                Sil
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
