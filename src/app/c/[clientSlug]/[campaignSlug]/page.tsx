import { Metadata } from "next";
import { db } from "@/db";
import { campaigns, clients, templates } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTemplate } from "@/templates/registry";
import type {
  LogoBackground,
  LogoPosition,
  TemplateClient,
  TemplateCampaign,
} from "@/templates/types";
import { BlockTreeRenderer } from "@/templates/blocks/renderer";
import { parseBlockTree } from "@/templates/blocks/schema";
import type { GatingQuestion } from "@/lib/gating";

interface Props {
  params: Promise<{ clientSlug: string; campaignSlug: string }>;
}

async function getCampaign(clientSlug: string, campaignSlug: string) {
  const [row] = await db
    .select({
      campaign_slug: campaigns.slug,
      role_title: campaigns.role_title,
      role_description: campaigns.role_description,
      department: campaigns.department,
      location: campaigns.location,
      employment_type: campaigns.employment_type,
      salary_range_min: campaigns.salary_range_min,
      salary_range_max: campaigns.salary_range_max,
      gating_config: campaigns.gating_config,
      status: campaigns.status,
      client_slug: clients.slug,
      client_name: clients.name,
      branding_logo_url: clients.branding_logo_url,
      logo_background: clients.logo_background,
      logo_position: clients.logo_position,
      brand_primary_color: clients.brand_primary_color,
      brand_secondary_color: clients.brand_secondary_color,
      brand_accent_color: clients.brand_accent_color,
      brand_text_color: clients.brand_text_color,
      template_key: templates.key,
      template_status: templates.status,
      template_source: templates.source,
      template_published_block_tree: templates.published_block_tree,
    })
    .from(campaigns)
    .innerJoin(clients, eq(campaigns.client_id, clients.id))
    .innerJoin(templates, eq(campaigns.template_id, templates.id))
    .where(and(eq(clients.slug, clientSlug), eq(campaigns.slug, campaignSlug)))
    .limit(1);

  return row ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clientSlug, campaignSlug } = await params;
  const campaign = await getCampaign(clientSlug, campaignSlug);

  if (!campaign || campaign.status !== "active") {
    return { title: "Campaign Not Available" };
  }

  const title = campaign.client_name
    ? `${campaign.role_title} at ${campaign.client_name} — Apply Now`
    : `${campaign.role_title} — Apply Now`;

  return {
    title,
    description: campaign.role_description
      ? campaign.role_description.slice(0, 160)
      : `Apply for the ${campaign.role_title} position.`,
  };
}

export default async function CampaignPage({ params }: Props) {
  const { clientSlug, campaignSlug } = await params;
  const campaign = await getCampaign(clientSlug, campaignSlug);

  if (!campaign) {
    return (
      <CampaignError
        title="Campaign not found"
        message="The campaign you're looking for doesn't exist. Please check the URL or contact the employer for the correct link."
      />
    );
  }

  if (campaign.status !== "active") {
    return (
      <CampaignError
        title="This campaign is no longer active"
        message="Applications for this position have closed. If you believe this is an error, please contact the employer directly."
      />
    );
  }

  // Only templates that have ever been published can render publicly.
  // Archived templates keep rendering their last-published snapshot for
  // live campaigns. Draft/pending templates show "coming soon".
  if (
    campaign.template_status !== "published" &&
    campaign.template_status !== "archived"
  ) {
    return (
      <CampaignError
        title="Coming soon"
        message="This campaign page is being set up. Please check back shortly."
      />
    );
  }

  const clientProps: TemplateClient = {
    slug: campaign.client_slug,
    name: campaign.client_name,
    logo_url: campaign.branding_logo_url,
    logo_background: (campaign.logo_background ?? "light") as LogoBackground,
    logo_position: (campaign.logo_position ?? "top-left") as LogoPosition,
    brand_primary_color: campaign.brand_primary_color ?? "#0b0f1c",
    brand_secondary_color: campaign.brand_secondary_color ?? "#f3f0e8",
    brand_accent_color: campaign.brand_accent_color,
    brand_text_color: campaign.brand_text_color ?? "#0b0f1c",
  };

  const campaignProps: TemplateCampaign = {
    slug: campaign.campaign_slug,
    role_title: campaign.role_title,
    role_description: campaign.role_description,
    department: campaign.department,
    location: campaign.location,
    employment_type: campaign.employment_type,
    salary_range_min: campaign.salary_range_min,
    salary_range_max: campaign.salary_range_max,
    gating_config: (campaign.gating_config ?? []) as GatingQuestion[],
  };

  if (campaign.template_source === "builtin") {
    const TemplateComponent = getTemplate(campaign.template_key);
    if (!TemplateComponent) {
      console.error(
        `[candidate-landing] Builtin template component missing from registry for key: "${campaign.template_key}" (client="${clientSlug}", campaign="${campaignSlug}").`
      );
      return (
        <CampaignError
          title="Something went wrong"
          message="We couldn't load this campaign page. Please try again later or contact the employer."
        />
      );
    }
    // eslint-disable-next-line react-hooks/static-components
    return <TemplateComponent client={clientProps} campaign={campaignProps} />;
  }

  // Custom (DB-stored) template → block tree. Always read from the
  // published snapshot, never from the working copy — this is what
  // keeps live campaigns stable while admins edit drafts.
  const treeToRender = campaign.template_published_block_tree;
  if (!treeToRender) {
    console.error(
      `[candidate-landing] Custom template has no published_block_tree (template_key="${campaign.template_key}", client="${clientSlug}", campaign="${campaignSlug}", status="${campaign.template_status}"). Transition to published should have snapshotted the tree.`
    );
    return (
      <CampaignError
        title="Coming soon"
        message="This campaign page is being set up. Please check back shortly."
      />
    );
  }
  const parsed = parseBlockTree(treeToRender);
  if (!parsed.ok) {
    console.error(
      `[candidate-landing] Custom template published_block_tree failed validation (template_key="${campaign.template_key}", client="${clientSlug}", campaign="${campaignSlug}"):`,
      parsed.errors
    );
    return (
      <CampaignError
        title="Something went wrong"
        message="We couldn't load this campaign page. Please try again later or contact the employer."
      />
    );
  }
  return (
    <BlockTreeRenderer
      tree={parsed.tree}
      client={clientProps}
      campaign={campaignProps}
    />
  );
}

function CampaignError({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-border">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6.5v4M10 13.5v.01" />
          </svg>
        </div>
        <h1 className="font-serif text-xl italic text-charcoal">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-txt-secondary">{message}</p>
      </div>
    </div>
  );
}
