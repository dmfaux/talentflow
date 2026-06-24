import { requireTenant } from "@/lib/tenant";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { asModelTier, clampTier } from "@/lib/ai/resolve-tier";
import { CampaignWizard } from "@/components/admin/campaign-wizard";

// Server-component auth guard; the wizard is a client component that fetches its
// own brand + theme data. (The campaign just picks a theme — there is no
// per-campaign landing override to tier-gate any more.)
export default async function NewCampaignPage() {
  const ctx = await requireTenant();

  // Effective model-tier cap = the more restrictive of the owner's and operator's
  // caps. Tiers above it render locked in the wizard's scoring-intelligence step.
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, ctx.effectiveOrgId!),
    columns: { max_model_tier: true, operator_max_model_tier: true },
  });
  const orgMaxTier = clampTier(
    asModelTier(org?.max_model_tier),
    asModelTier(org?.operator_max_model_tier)
  );

  return (
    <CampaignWizard
      mode="create"
      cancelHref="/campaigns"
      breadcrumbLabel="New Campaign"
      orgMaxTier={orgMaxTier}
    />
  );
}
