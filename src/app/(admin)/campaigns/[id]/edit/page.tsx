import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns, organizations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { orgScope, requireTenant } from "@/lib/tenant";
import { asModelTier, clampTier } from "@/lib/ai/resolve-tier";
import {
  CampaignWizard,
  type FormData as WizardFormData,
} from "@/components/admin/campaign-wizard";
import { JobSpecRedirectToast } from "@/components/admin/job-spec-redirect-toast";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

interface ScoringRubric {
  must_haves?: string[];
  nice_to_haves?: string[];
  dealbreakers?: string[];
  dimension_weights?: {
    skills?: number;
    experience?: number;
    progression?: number;
    tenure?: number;
  };
  min_score?: number;
  max_auto_advance_score?: number;
}

export default async function EditCampaignPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;

  // S4: org-scope the read — a cross-org campaign id notFound()s instead of
  // loading another tenant's campaign config into the edit wizard.
  const ctx = await requireTenant();

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), orgScope(campaigns, ctx)),
  });

  // Only draft campaigns can be edited. Everything else (active, paused,
  // closed, archived) 404s — once a campaign has been published we treat
  // its configuration as locked so candidates all see the same thing.
  if (!campaign || campaign.status !== "draft") notFound();

  const rubric = (campaign.scoring_rubric ?? {}) as ScoringRubric;
  const weights = rubric.dimension_weights ?? {};

  // Keep at least one row in each list — the wizard's UI starts at [""]
  // rather than [] so users see an empty input to type into.
  const withPlaceholder = (arr: string[] | undefined) =>
    arr && arr.length > 0 ? arr : [""];

  const initialForm: Partial<WizardFormData> = {
    client_id: campaign.client_id,
    slug: campaign.slug,
    role_title: campaign.role_title,
    role_description: campaign.role_description ?? "",
    department: campaign.department ?? "",
    location: campaign.location ?? "",
    employment_type: campaign.employment_type ?? "",
    salary_range_min: campaign.salary_range_min?.toString() ?? "",
    salary_range_max: campaign.salary_range_max?.toString() ?? "",
    gating_config: (campaign.gating_config as WizardFormData["gating_config"]) ?? [],
    must_haves: withPlaceholder(rubric.must_haves),
    nice_to_haves: withPlaceholder(rubric.nice_to_haves),
    dealbreakers: withPlaceholder(rubric.dealbreakers),
    dimension_weights: {
      skills: weights.skills ?? 25,
      experience: weights.experience ?? 25,
      progression: weights.progression ?? 25,
      tenure: weights.tenure ?? 25,
    },
    min_score: rubric.min_score ?? 5,
    max_auto_advance_score: rubric.max_auto_advance_score ?? 8,
    ghost_ttl_days: campaign.ghost_ttl_days ?? 10,
    selected_model_tier: asModelTier(campaign.selected_model_tier),
    theme_id: campaign.theme_id ?? null,
  };

  // Effective model-tier cap (more restrictive of owner + operator caps).
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, campaign.org_id),
    columns: { max_model_tier: true, operator_max_model_tier: true },
  });
  const orgMaxTier = clampTier(
    asModelTier(org?.max_model_tier),
    asModelTier(org?.operator_max_model_tier)
  );

  return (
    <>
      {from === "job-spec" && <JobSpecRedirectToast />}
      <CampaignWizard
        mode="edit"
        campaignId={campaign.id}
        initialForm={initialForm}
        orgMaxTier={orgMaxTier}
        lockClient
        cancelHref={`/campaigns/${campaign.id}`}
        breadcrumbLabel={`Edit ${campaign.role_title}`}
      />
    </>
  );
}
