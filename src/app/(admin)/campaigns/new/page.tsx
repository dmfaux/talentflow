import { requireTenant } from "@/lib/tenant";
import { CampaignWizard } from "@/components/admin/campaign-wizard";

// Server-component auth guard; the wizard is a client component that fetches its
// own brand + theme data. (The campaign just picks a theme — there is no
// per-campaign landing override to tier-gate any more.)
export default async function NewCampaignPage() {
  await requireTenant();

  return (
    <CampaignWizard
      mode="create"
      cancelHref="/campaigns"
      breadcrumbLabel="New Campaign"
    />
  );
}
