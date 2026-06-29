import { Metadata } from "next";
import { db } from "@/db";
import { campaigns, clients, organizations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ApplicationStatusClient } from "@/components/candidate/ApplicationStatusClient";

interface Props {
  params: Promise<{ clientSlug: string; campaignSlug: string }>;
}

async function getCampaignForStatus(clientSlug: string, campaignSlug: string) {
  const [row] = await db
    .select({
      role_title: campaigns.role_title,
      // Org lifecycle status (S11) — refuse a suspended/deleted org's surface.
      // Campaign status is intentionally NOT gated: a candidate added to a
      // campaign that has since paused or closed must still be able to view
      // their status and exercise their POPIA opt-out.
      org_status: organizations.status,
      client_name: clients.name,
      brand_primary_color: clients.brand_primary_color,
      brand_secondary_color: clients.brand_secondary_color,
      brand_accent_color: clients.brand_accent_color,
      brand_text_color: clients.brand_text_color,
      branding_logo_url: clients.branding_logo_url,
      logo_background: clients.logo_background,
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
  const campaign = await getCampaignForStatus(clientSlug, campaignSlug);

  if (!campaign || campaign.org_status !== "active") {
    return { title: "Application Not Available" };
  }

  return {
    title: `Your application — ${campaign.role_title} at ${campaign.client_name}`,
  };
}

export default async function ApplicationStatusPage({ params }: Props) {
  const { clientSlug, campaignSlug } = await params;
  const campaign = await getCampaignForStatus(clientSlug, campaignSlug);

  if (!campaign || campaign.org_status !== "active") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0]">
        <div className="mx-auto max-w-md rounded-xl border border-[#e8e8e4] bg-white px-8 py-10 text-center">
          <h1 className="font-serif text-xl italic text-[#11123c]">
            Application not available
          </h1>
          <p className="mt-3 text-sm text-[#666]">
            This link isn&apos;t available right now. If you believe this is an
            error, please contact the employer directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ApplicationStatusClient
      clientSlug={clientSlug}
      campaignSlug={campaignSlug}
      roleTitle={campaign.role_title}
      companyName={campaign.client_name}
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
