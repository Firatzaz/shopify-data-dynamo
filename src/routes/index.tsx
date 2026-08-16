import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stok Senkron — Shopify mağazaları arası stok eşitleme" },
      {
        name: "description",
        content:
          "Birden fazla Shopify mağazasında stokları SKU bazında gerçek zamanlı eşitleyin; kurallar, tampon stok ve değiştirilemez denetim kaydı ile.",
      },
      { property: "og:title", content: "Stok Senkron — Shopify stok eşitleme" },
      {
        property: "og:description",
        content: "SKU bazlı çok mağazalı stok senkronizasyonu, döngü koruması ve denetim kaydı.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const features = [
  {
    title: "Gerçek zamanlı senkron",
    body: "Shopify webhook'ları kuyruğa yazılır, işleyici SKU eşleşmesine göre hedef mağazaları güncelleyerek stokları saniyeler içinde eşitler.",
  },
  {
    title: "Kural bazlı kontrol",
    body: "Her mağaza çifti için alan bazında (stok, fiyat, başlık…) izin verin, tampon stok belirleyin, önce kuru çalışma ile test edin.",
  },
  {
    title: "Değiştirilemez denetim kaydı",
    body: "Her karar eski/yeni değerle kayda geçer; veritabanı seviyesinde silme ve düzenleme engellidir.",
  },
  {
    title: "Döngü koruması",
    body: "Kaynak mağaza takibi ve tekrarlanan webhook tespiti ile mağazalar arası sonsuz güncelleme döngüleri engellenir.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-sm font-semibold tracking-tight">Stok Senkron</span>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Giriş yap
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Shopify mağazalarınız arasında stokları tek bir doğruluk kaynağından eşitleyin
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Mağazalarınızı OAuth ile bağlayın, SKU bazlı kurallar tanımlayın; stok hareketleri
            otomatik olarak dağıtılır ve her adım denetlenebilir kalır.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Ücretsiz başla
            </Link>
            <Link
              to="/dashboard"
              className="rounded-md border border-input px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Panele git
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted-foreground">
          Stok Senkron · Shopify Admin API ile çalışır
        </div>
      </footer>
    </div>
  );
}
