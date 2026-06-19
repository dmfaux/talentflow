import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireTenant } from "@/lib/tenant";
import { isPremiumTier } from "@/lib/theme-fields";
import { CampaignWizard } from "@/components/admin/campaign-wizard";

// Server component so it can read the authoritative org tier (organizations.tier)
// and gate the Premium-only landing override (CT5). The wizard itself stays a
// client component; we only pass it a serializable boolean.
export default async function NewCampaignPage() {
  const ctx = await requireTenant();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, ctx.effectiveOrgId!),
    columns: { tier: true },
  });

  return (
    <CampaignWizard
      mode="create"
      cancelHref="/campaigns"
      breadcrumbLabel="New Campaign"
      canOverrideLanding={isPremiumTier(org?.tier ?? null)}
    />
  );
}
