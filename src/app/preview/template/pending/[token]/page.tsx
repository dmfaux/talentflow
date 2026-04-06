// Unauthenticated preview route for templates in status='pending'.
// Shared with clients via a time-limited token for approval review.

import { db } from "@/db";
import { clients, templates } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { replaceSlots, type SlotData } from "@/lib/templates/slots";
import { HtmlTemplateRenderer } from "@/components/candidate/HtmlTemplateRenderer";
import type { GatingQuestion } from "@/lib/gating";

interface Props {
  params: Promise<{ token: string }>;
}

const DEMO_SLOT_DATA: SlotData = {
  client: { name: "Acme Co." },
  campaign: {
    role_title: "Senior Role - Preview",
    role_description:
      "This is a sample role description used to preview the template. Candidates will see the actual role title, description, and details you configure when creating a campaign with this template.",
    department: "Operations",
    location: "Cape Town",
    employment_type: "Full-time",
    salary_range_min: 750000,
    salary_range_max: 1100000,
  },
};

export default async function TemplatePendingPreview({ params }: Props) {
  const { token } = await params;

  if (!token || token.length > 128) {
    return <PreviewNotice title="Invalid preview link" />;
  }

  const now = new Date();
  const row = await db
    .select({
      id: templates.id,
      name: templates.name,
      status: templates.status,
      html_template: templates.html_template,
      owner_client_id: templates.owner_client_id,
    })
    .from(templates)
    .where(
      and(
        eq(templates.preview_token, token),
        gt(templates.preview_token_expires_at, now)
      )
    )
    .limit(1);

  if (row.length === 0) {
    return (
      <PreviewNotice
        title="Preview link expired or invalid"
        message="Ask the template admin to regenerate the link."
      />
    );
  }

  const template = row[0];

  if (template.status !== "pending") {
    return (
      <PreviewNotice
        title="Template is no longer pending review"
        message="The admin has moved this template out of review."
      />
    );
  }

  if (!template.html_template) {
    return (
      <PreviewNotice
        title="Template preview unavailable"
        message="No HTML template content found."
      />
    );
  }

  // Resolve branding for the ApplicationForm portal
  let clientName = "Acme Co.";
  let clientSlug = "acme-co";
  let brandPrimary = "#0b3a82";
  let brandSecondary = "#f5f7fb";
  let brandAccent: string | null = "#f0a500";
  let brandText = "#0b0f1c";

  if (template.owner_client_id) {
    const owner = await db.query.clients.findFirst({
      where: eq(clients.id, template.owner_client_id),
    });
    if (owner) {
      clientName = owner.name;
      clientSlug = owner.slug;
      brandPrimary = owner.brand_primary_color ?? brandPrimary;
      brandSecondary = owner.brand_secondary_color ?? brandSecondary;
      brandAccent = owner.brand_accent_color;
      brandText = owner.brand_text_color ?? brandText;
    }
  }

  const slotData: SlotData = {
    ...DEMO_SLOT_DATA,
    client: { name: clientName },
  };
  const processedHtml = replaceSlots(template.html_template, slotData);

  return (
    <>
      <PreviewBanner templateName={template.name} />
      <HtmlTemplateRenderer
        html={processedHtml}
        clientSlug={clientSlug}
        clientName={clientName}
        campaign={{
          slug: "preview",
          role_title: "Senior Role - Preview",
          gating_config: [] as GatingQuestion[],
        }}
        brandColours={{
          primary: brandPrimary,
          secondary: brandSecondary,
          accent: brandAccent,
          text: brandText,
        }}
      />
    </>
  );
}

function PreviewBanner({ templateName }: { templateName: string }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backgroundColor: "#0b0f1c",
        color: "#ffffff",
        padding: "0.625rem 1rem",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        fontSize: "0.75rem",
        textAlign: "center",
        letterSpacing: "0.04em",
      }}
    >
      <strong style={{ fontWeight: 600 }}>PREVIEW</strong> — {templateName}{" "}
      — shown with sample role data for review only
    </div>
  );
}

function PreviewNotice({
  title,
  message,
}: {
  title: string;
  message?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        backgroundColor: "#f3f0e8",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: "420px", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>{title}</h1>
        {message && (
          <p style={{ fontSize: "0.875rem", color: "#58607a" }}>{message}</p>
        )}
      </div>
    </div>
  );
}
