import { Metadata } from "next";
import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";

interface Props {
  params: Promise<{ clientSlug: string; campaignSlug: string }>;
}

async function getCampaign(clientSlug: string, campaignSlug: string) {
  const [row] = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      role_title: campaigns.role_title,
      role_description: campaigns.role_description,
      status: campaigns.status,
      html_template: campaigns.html_template,
      client_name: clients.name,
    })
    .from(campaigns)
    .innerJoin(clients, eq(campaigns.client_id, clients.id))
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
    return <CampaignError title="Campaign not found" message="The campaign you're looking for doesn't exist. Please check the URL or contact the employer for the correct link." />;
  }

  if (campaign.status !== "active") {
    return <CampaignError title="This campaign is no longer active" message="Applications for this position have closed. If you believe this is an error, please contact the employer directly." />;
  }

  if (!campaign.html_template) {
    return <CampaignError title="Coming soon" message="This campaign page is being set up. Please check back shortly." />;
  }

  return (
    <div
      className="campaign-template"
      dangerouslySetInnerHTML={{ __html: campaign.html_template }}
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
