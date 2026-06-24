import { Metadata } from "next";
import { db } from "@/db";
import { campaigns, clients, organizations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { replaceSlots, type SlotData } from "@/lib/slots";
import { renderMarkdown } from "@/lib/markdown";
import { HtmlTemplateRenderer } from "@/components/candidate/HtmlTemplateRenderer";
import type { GatingQuestion } from "@/lib/gating";
import { resolveEffectiveLanding } from "@/lib/theme";

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
      // Org lifecycle status (S11) — the public seam doesn't run here, so we
      // refuse a suspended/deleted org's careers page in the handler.
      org_status: organizations.status,
      client_slug: clients.slug,
      client_name: clients.name,
      brand_primary_color: clients.brand_primary_color,
      brand_secondary_color: clients.brand_secondary_color,
      brand_accent_color: clients.brand_accent_color,
      brand_text_color: clients.brand_text_color,
      // Theme/landing resolution inputs (CT5). theme_snapshot wins for active
      // campaigns; drafts resolve the brand's theme default live.
      theme_id: campaigns.theme_id,
      theme_snapshot: campaigns.theme_snapshot,
      default_theme_id: clients.default_theme_id,
      branding_logo_url: clients.branding_logo_url,
      logo_background: clients.logo_background,
      logo_position: clients.logo_position,
    })
    .from(campaigns)
    .innerJoin(clients, eq(campaigns.client_id, clients.id))
    .innerJoin(organizations, eq(campaigns.org_id, organizations.id))
    .where(and(eq(clients.slug, clientSlug), eq(campaigns.slug, campaignSlug)))
    .limit(1);

  return row ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clientSlug, campaignSlug } = await params;
  const campaign = await getCampaign(clientSlug, campaignSlug);

  if (!campaign || campaign.status !== "active" || campaign.org_status !== "active") {
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

  // Suspended/deleted org → freeze the careers page (S11). No PII, no org-state
  // detail leaked — the same generic "unavailable" surface for both states.
  if (campaign.org_status !== "active") {
    return (
      <CampaignError
        title="This organisation isn't currently accepting applications"
        message="Applications for this position aren't available right now. If you believe this is an error, please contact the employer directly."
      />
    );
  }

  // Effective landing: active → frozen snapshot (the theme's bespoke landing, or
  // the themed landing regenerated from the frozen palette); draft → live theme
  // (its bespoke landing, else the generated one). Always a string — a campaign
  // is never landing-less.
  const landingHtml = await resolveEffectiveLanding({
    theme_id: campaign.theme_id,
    theme_snapshot: campaign.theme_snapshot,
    client: {
      default_theme_id: campaign.default_theme_id,
      branding_logo_url: campaign.branding_logo_url,
      logo_background: campaign.logo_background,
      logo_position: campaign.logo_position,
    },
  });

  // Replace slot markers with campaign data.
  const slotData: SlotData = {
    client: { name: campaign.client_name },
    campaign: {
      role_title: campaign.role_title,
      role_description: renderMarkdown(campaign.role_description),
      department: campaign.department,
      location: campaign.location,
      employment_type: campaign.employment_type,
      salary_range_min: campaign.salary_range_min,
      salary_range_max: campaign.salary_range_max,
    },
  };
  const processedHtml = replaceSlots(landingHtml, slotData);

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
        primary: campaign.brand_primary_color ?? "#11123c",
        secondary: campaign.brand_secondary_color ?? "#f0f3f7",
        accent: campaign.brand_accent_color,
        text: campaign.brand_text_color ?? "#11123c",
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
