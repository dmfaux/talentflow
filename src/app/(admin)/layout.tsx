import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { AdminSidebar } from "@/components/admin/sidebar";
import { ActiveCampaignCount } from "@/components/admin/active-campaign-count";
import { BrandSwitcher } from "@/components/admin/brand-switcher";
import { NoBrandBanner } from "@/components/admin/no-brand-banner";
import { TenantProvider } from "@/components/admin/tenant-provider";
import { ActingAsBanner } from "@/components/operator/acting-as-banner";
import { ToastProvider } from "@/components/ui/toast-provider";
import { Logo } from "@/components/brand/logo";
// Pure helper + type imported from the neutral module, not the "use client"
// provider — a server component cannot invoke a client-module export.
import { canManageOrg, type TenantBrand } from "@/components/admin/tenant-shared";
import { getBrandMemberships, requireTenant } from "@/lib/tenant";
import { getActAsClaim } from "@/lib/auth";
import { db } from "@/db";
import { clients, organizations } from "@/db/schema";

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
        columns: { name: true, status: true, tier: true },
      })
    : null;

  // The act-as time-box end (epoch ms) for the banner countdown. Read from the
  // same signed claim the seam already validated; the cookie is the enforcer.
  const actExpiresAt = ctx.actingOrgId
    ? (await getActAsClaim())?.expiresAt ?? null
    : null;

  // Resolve the client-visible tenant context (S8): org name + the caller's
  // accessible brands. Owner/org_admin/acting-operator span every brand in the
  // org; a plain member sees only their membership brands.
  const org =
    actingOrg ??
    (ctx.effectiveOrgId
      ? await db.query.organizations.findFirst({
          where: eq(organizations.id, ctx.effectiveOrgId),
          columns: { name: true, tier: true },
        })
      : null);

  const tenantValue = {
    userId: ctx.userId,
    orgRole: ctx.orgRole,
    isOperator: ctx.isOperator,
    actingOrgId: ctx.actingOrgId,
    activeBrandId: ctx.activeBrandId,
    orgName: org?.name ?? null,
    // Authoritative tier from the org; brands inherit it (clients.tier is a
    // dead mirror). Defaults to "standard" only if the org row is missing.
    orgTier: org?.tier ?? "standard",
    brands: [] as TenantBrand[],
  };

  if (ctx.effectiveOrgId) {
    if (canManageOrg(tenantValue)) {
      tenantValue.brands = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(eq(clients.org_id, ctx.effectiveOrgId))
        .orderBy(asc(clients.name));
    } else {
      const memberships = await getBrandMemberships(ctx.userId);
      const ids = memberships.map((m) => m.clientId);
      tenantValue.brands = ids.length
        ? await db
            .select({ id: clients.id, name: clients.name })
            .from(clients)
            .where(inArray(clients.id, ids))
            .orderBy(asc(clients.name))
        : [];
    }
  }

  return (
    <TenantProvider value={tenantValue}>
      <div className="min-h-screen bg-canvas font-sans">
        {actingOrg && (
          <ActingAsBanner
            orgName={actingOrg.name}
            status={actingOrg.status}
            expiresAt={actExpiresAt}
          />
        )}
        {/* Top bar */}
        <header className="sticky top-[var(--dev-banner-h,0px)] z-30 flex h-14 items-center justify-between border-b border-rule bg-paper/85 px-6 backdrop-blur-md">
          <Link href="/dashboard" className="group" aria-label="TalentStream admin">
            <Logo size="md" />
          </Link>
          <div className="flex items-center gap-4">
            <div id="admin-header-default" className="flex items-center">
              <ActiveCampaignCount />
            </div>
            <div id="admin-header-slot" className="flex items-center">
              <BrandSwitcher />
            </div>
          </div>
        </header>

        {/* Persistent onboarding nudge — self-hides once a brand exists. */}
        <NoBrandBanner />

        <div className="flex">
          {/* Sidebar */}
          <AdminSidebar />

          {/* Main content */}
          <main className="flex-1 px-8 py-6">
            <ToastProvider>{children}</ToastProvider>
          </main>
        </div>
      </div>
    </TenantProvider>
  );
}
