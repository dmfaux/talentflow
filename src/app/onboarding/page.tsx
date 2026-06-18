import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireTenant } from "@/lib/tenant";
import { db } from "@/db";
import { clients, organizations, users } from "@/db/schema";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata = { title: "Welcome to TalentStream" };

// Full-screen first-run wizard, deliberately OUTSIDE the (admin) shell — no
// sidebar/top-bar chrome, so it reads as a welcome moment rather than another
// admin page. The invite-accept flow lands new owners here; this page is the
// gate that decides whether onboarding is still owed.
export default async function OnboardingPage() {
  // Reuse the same auth seam as the admin shell — redirects to /login if there
  // is no valid session (and bounces a suspended/deleted org).
  const ctx = await requireTenant();

  // An operator with no act-as target has no tenant to onboard.
  if (ctx.isOperator && !ctx.actingOrgId) redirect("/operator");

  // Only owners/org_admins (or an acting operator) can create a brand — mirrors
  // the manage_brand gate the POST enforces. Anyone else can't complete the
  // wizard, so drop them straight into the app.
  const canManage =
    ctx.orgRole === "owner" ||
    ctx.orgRole === "org_admin" ||
    (ctx.isOperator && ctx.actingOrgId !== null);
  if (!canManage || !ctx.effectiveOrgId) redirect("/dashboard");

  // Onboarding is a one-time gate: the moment the org owns any brand it's done.
  // A server-side redirect (not a client flash) for brand-level invitees and
  // any returning admin who already has brands.
  const existingBrand = await db.query.clients.findFirst({
    where: eq(clients.org_id, ctx.effectiveOrgId),
    columns: { id: true },
  });
  if (existingBrand) redirect("/dashboard");

  const [me, org] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { first_name: true },
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.effectiveOrgId),
      columns: { name: true },
    }),
  ]);

  return (
    <OnboardingWizard
      firstName={me?.first_name ?? null}
      orgName={org?.name ?? null}
    />
  );
}
