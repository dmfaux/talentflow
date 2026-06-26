import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireOperator } from "@/lib/tenant";
import { ToastProvider } from "@/components/ui/toast-provider";
import { OperatorLogout } from "@/components/operator/operator-logout";

// The operator console — a deliberately DISTINCT shell from the tenant (admin)
// surface (no AdminSidebar): dark control-plane chrome, mono identifiers,
// data-forward density, so an operator never mistakes it for a tenant view.
// requireOperator() 404s any non-operator (existence hidden, §5.6).
export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireOperator();

  const operator = await db.query.users.findFirst({
    where: eq(users.id, ctx.userId),
    columns: { first_name: true, last_name: true, email: true },
  });
  const operatorName = operator
    ? `${operator.first_name} ${operator.last_name}`.trim() || operator.email
    : "operator";

  return (
    <div className="min-h-screen bg-canvas font-sans">
      {/* Control-plane top bar */}
      <header className="sticky top-[var(--dev-banner-h,0px)] z-30 border-b border-white/10 bg-ink">
        {/* hairline accent — the operator surface's signature */}
        <div className="h-0.5 w-full bg-gradient-to-r from-vermillion via-cobalt to-vermillion" />
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/operator" className="group flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-vermillion opacity-60 pulse-dot" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-vermillion" />
              </span>
              <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-white">
                Talentstream
                <span className="ml-2 text-vermillion">Operator</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <Link
                href="/operator"
                className="rounded-md px-2.5 py-1 text-[0.72rem] font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                Organisations
              </Link>
              <Link
                href="/operator/themes"
                className="rounded-md px-2.5 py-1 text-[0.72rem] font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                Themes
              </Link>
              <Link
                href="/operator/plans"
                className="rounded-md px-2.5 py-1 text-[0.72rem] font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                Plans
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[0.68rem] text-white/45 md:inline">
              {operatorName}
            </span>
            <OperatorLogout />
          </div>
        </div>
      </header>

      <main className="px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </main>
    </div>
  );
}
