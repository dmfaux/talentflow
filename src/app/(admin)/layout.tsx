import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AdminSidebar } from "@/components/admin/sidebar";
import { ActiveCampaignCount } from "@/components/admin/active-campaign-count";
import { ActingAsBanner } from "@/components/operator/acting-as-banner";
import { ToastProvider } from "@/components/ui/toast-provider";
import { Logo } from "@/components/brand/logo";
import { requireTenant } from "@/lib/tenant";
import { db } from "@/db";
import { organizations } from "@/db/schema";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Enforce tenant context once per shell. Redirects to /login if there is no
  // valid session — the structural guard that replaces middleware-only auth.
  const ctx = await requireTenant();

  // A non-acting operator (effectiveOrgId === null) has no tenant data here —
  // send them to the operator console instead of an empty admin shell. Once
  // impersonating, ctx.actingOrgId is set and the shell is transparently scoped
  // to that org (S4/S5), with the act-as banner below.
  if (ctx.isOperator && !ctx.actingOrgId) redirect("/operator");

  const actingOrg = ctx.actingOrgId
    ? await db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.actingOrgId),
        columns: { name: true, status: true },
      })
    : null;

  return (
    <div className="min-h-screen bg-canvas font-sans">
      {actingOrg && (
        <ActingAsBanner orgName={actingOrg.name} status={actingOrg.status} />
      )}
      {/* Top bar */}
      <header className="sticky top-[var(--dev-banner-h,0px)] z-30 flex h-14 items-center justify-between border-b border-rule bg-paper/85 px-6 backdrop-blur-md">
        <Link href="/dashboard" className="group" aria-label="TalentStream admin">
          <Logo size="md" />
        </Link>
        <div className="flex items-center">
          <div id="admin-header-default" className="flex items-center">
            <ActiveCampaignCount />
          </div>
          <div id="admin-header-slot" className="flex items-center" />
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <AdminSidebar />

        {/* Main content */}
        <main className="flex-1 px-8 py-6">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
