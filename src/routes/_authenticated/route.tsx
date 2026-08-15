import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

const nav = [
  { to: "/dashboard", label: "Panel" },
  { to: "/stores", label: "Mağazalar" },
  { to: "/rules", label: "Kurallar" },
  { to: "/logs", label: "Loglar" },
] as const;

function AuthenticatedLayout() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-sm font-semibold tracking-tight">Stok Senkron</span>
          <nav className="flex flex-wrap gap-1">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={async () => {
              await supabase.auth.signOut();
              router.navigate({ to: "/auth" });
            }}
          >
            Çıkış
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
