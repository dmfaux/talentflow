import { Metadata } from "next";
import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { renderMarkdown } from "@/lib/markdown";
import { ChatPageClient } from "@/components/candidate/ChatPageClient";

interface Props {
  params: Promise<{ clientSlug: string; campaignSlug: string }>;
}

async function getCampaignForChat(clientSlug: string, campaignSlug: string) {
  const [row] = await db
    .select({
      role_title: campaigns.role_title,
      role_description: campaigns.role_description,
      location: campaigns.location,
      employment_type: campaigns.employment_type,
      salary_range_min: campaigns.salary_range_min,
      salary_range_max: campaigns.salary_range_max,
      status: campaigns.status,
      client_name: clients.name,
      brand_primary_color: clients.brand_primary_color,
      brand_secondary_color: clients.brand_secondary_color,
      brand_accent_color: clients.brand_accent_color,
      brand_text_color: clients.brand_text_color,
      branding_logo_url: clients.branding_logo_url,
      logo_position: clients.logo_position,
    })
    .from(campaigns)
    .innerJoin(clients, eq(campaigns.client_id, clients.id))
    .where(and(eq(clients.slug, clientSlug), eq(campaigns.slug, campaignSlug)))
    .limit(1);

  return row ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clientSlug, campaignSlug } = await params;
  const campaign = await getCampaignForChat(clientSlug, campaignSlug);

  if (!campaign || campaign.status !== "active") {
    return { title: "Chat Not Available" };
  }

  return {
    title: `Chat — ${campaign.role_title} at ${campaign.client_name}`,
  };
}

export default async function ChatPage({ params }: Props) {
  const { clientSlug, campaignSlug } = await params;
  const campaign = await getCampaignForChat(clientSlug, campaignSlug);

  if (!campaign || campaign.status !== "active") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0]">
        <div className="mx-auto max-w-md rounded-xl border border-[#e8e8e4] bg-white px-8 py-10 text-center">
          <h1 className="font-serif text-xl italic text-[#11123c]">
            Chat not available
          </h1>
          <p className="mt-3 text-sm text-[#666]">
            This campaign is no longer active. If you believe this is an error,
            please contact the employer directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChatPageClient
      clientSlug={clientSlug}
      campaignSlug={campaignSlug}
      roleTitle={campaign.role_title}
      roleDescriptionHtml={renderMarkdown(campaign.role_description)}
      companyName={campaign.client_name}
      location={campaign.location}
      employmentType={campaign.employment_type}
      salaryMin={campaign.salary_range_min}
      salaryMax={campaign.salary_range_max}
      logoUrl={campaign.branding_logo_url}
      brandColours={{
        primary: campaign.brand_primary_color ?? "#11123c",
        secondary: campaign.brand_secondary_color ?? "#f0f3f7",
        accent: campaign.brand_accent_color,
        text: campaign.brand_text_color ?? "#11123c",
      }}
    />
  );
}
