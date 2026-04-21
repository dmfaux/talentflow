import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { eq } from "drizzle-orm";
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

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, id),
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
    html_template: campaign.html_template ?? "",
    design_brief: campaign.design_brief ?? "",
  };

  return (
    <>
      {from === "job-spec" && <JobSpecRedirectToast />}
      <CampaignWizard
        mode="edit"
        campaignId={campaign.id}
        initialForm={initialForm}
        lockClient
        cancelHref={`/campaigns/${campaign.id}`}
        breadcrumbLabel={`Edit ${campaign.role_title}`}
      />
    </>
  );
}
