import { Metadata } from "next";
import { db } from "@/db";
import { campaigns, clients, templates } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { replaceSlots, type SlotData } from "@/lib/templates/slots";
import { renderMarkdown } from "@/lib/markdown";
import { HtmlTemplateRenderer } from "@/components/candidate/HtmlTemplateRenderer";
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
      key_responsibilities: campaigns.key_responsibilities,
      department: campaigns.department,
      location: campaigns.location,
      employment_type: campaigns.employment_type,
      salary_range_min: campaigns.salary_range_min,
      salary_range_max: campaigns.salary_range_max,
      gating_config: campaigns.gating_config,
      status: campaigns.status,
      client_slug: clients.slug,
      client_name: clients.name,
      brand_primary_color: clients.brand_primary_color,
      brand_secondary_color: clients.brand_secondary_color,
      brand_accent_color: clients.brand_accent_color,
      brand_text_color: clients.brand_text_color,
      template_status: templates.status,
      published_html_template: templates.published_html_template,
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

  if (!campaign.published_html_template) {
    console.error(
      `[candidate-landing] Template has no published_html_template (client="${clientSlug}", campaign="${campaignSlug}").`
    );
    return (
      <CampaignError
        title="Coming soon"
        message="This campaign page is being set up. Please check back shortly."
      />
    );
  }

  // Replace slot markers with campaign data.
  const slotData: SlotData = {
    client: { name: campaign.client_name },
    campaign: {
      role_title: campaign.role_title,
      role_description: renderMarkdown(campaign.role_description),
      key_responsibilities: renderMarkdown(campaign.key_responsibilities),
      department: campaign.department,
      location: campaign.location,
      employment_type: campaign.employment_type,
      salary_range_min: campaign.salary_range_min,
      salary_range_max: campaign.salary_range_max,
    },
  };
  const processedHtml = replaceSlots(
    campaign.published_html_template,
    slotData
  );

  return (
    <HtmlTemplateRenderer
      html={processedHtml}
      clientSlug={campaign.client_slug}
      clientName={campaign.client_name}
      campaign={{
        slug: campaign.campaign_slug,
        role_title: campaign.role_title,
        gating_config: (campaign.gating_config ?? []) as GatingQuestion[],
      }}
      brandColours={{
        primary: campaign.brand_primary_color ?? "#0b0f1c",
        secondary: campaign.brand_secondary_color ?? "#f3f0e8",
        accent: campaign.brand_accent_color,
        text: campaign.brand_text_color ?? "#0b0f1c",
      }}
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
