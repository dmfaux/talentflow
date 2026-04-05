"use client";

import { CampaignWizard } from "@/components/admin/campaign-wizard";

export default function NewCampaignPage() {
  return (
    <CampaignWizard
      mode="create"
      cancelHref="/campaigns"
      breadcrumbLabel="New Campaign"
    />
  );
}
