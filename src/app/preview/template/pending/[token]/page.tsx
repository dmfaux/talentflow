// Unauthenticated preview route for templates in status='pending'.
// Shared with clients via a time-limited token for approval review.
//
// Security model: the 32-char base64url token is unguessable. We don't
// list pending tokens anywhere — discovery requires the URL. Tokens
// are cleared the moment a template exits 'pending' (approve/reject),
// so stale links stop working immediately.

import { db } from "@/db";
import { clients, templates } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { BlockTreeRenderer } from "@/templates/blocks/renderer";
import { parseBlockTree } from "@/templates/blocks/schema";
import { getTemplate } from "@/templates/registry";
import type {
  LogoBackground,
  LogoPosition,
  TemplateCampaign,
  TemplateClient,
} from "@/templates/types";

interface Props {
  params: Promise<{ token: string }>;
}

// ── Demo data for the preview ───────────────────────────────────────
// Used when the template isn't bespoke to a specific client. Generic
// but realistic enough for a client to evaluate layout/typography.

const DEMO_CLIENT_FALLBACK: TemplateClient = {
  slug: "acme-co",
  name: "Acme Co.",
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#0b3a82",
  brand_secondary_color: "#f5f7fb",
  brand_accent_color: "#f0a500",
  brand_text_color: "#0b0f1c",
};

const DEMO_CAMPAIGN: TemplateCampaign = {
  slug: "senior-role-preview",
  role_title: "Senior Role · Preview",
  role_description:
    "This is a sample role description used to preview the template. Candidates will see the actual role title, description, and details you configure when creating a campaign with this template.",
  department: "Operations",
  location: "Cape Town",
  employment_type: "Full-time",
  salary_range_min: 750000,
  salary_range_max: 1_100_000,
  gating_config: [],
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
      source: templates.source,
      status: templates.status,
      key: templates.key,
      block_tree: templates.block_tree,
      owner_client_id: templates.owner_client_id,
      expires_at: templates.preview_token_expires_at,
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

  // If the template happens to no longer be in pending (e.g. a race
  // between our query and a status change), refuse. The token should
  // already have been cleared on exit, so this is defensive.
  if (template.status !== "pending") {
    return (
      <PreviewNotice
        title="Template is no longer pending review"
        message="The admin has moved this template out of review."
      />
    );
  }

  // Resolve preview branding: prefer the owning client's palette when
  // this is a bespoke template, else use demo defaults.
  let clientProps: TemplateClient = DEMO_CLIENT_FALLBACK;
  if (template.owner_client_id) {
    const owner = await db.query.clients.findFirst({
      where: eq(clients.id, template.owner_client_id),
    });
    if (owner) {
      clientProps = {
        slug: owner.slug,
        name: owner.name,
        logo_url: owner.branding_logo_url,
        logo_background: (owner.logo_background ?? "light") as LogoBackground,
        logo_position: (owner.logo_position ?? "top-left") as LogoPosition,
        brand_primary_color: owner.brand_primary_color ?? "#0b0f1c",
        brand_secondary_color: owner.brand_secondary_color ?? "#f3f0e8",
        brand_accent_color: owner.brand_accent_color,
        brand_text_color: owner.brand_text_color ?? "#0b0f1c",
      };
    }
  }

  // Render.
  if (template.source === "builtin") {
    const TemplateComponent = getTemplate(template.key);
    if (!TemplateComponent) {
      return <PreviewNotice title="Builtin template missing" />;
    }
    return (
      <>
        <PreviewBanner templateName={template.name} />
        {/* eslint-disable-next-line react-hooks/static-components */}
        <TemplateComponent client={clientProps} campaign={DEMO_CAMPAIGN} />
      </>
    );
  }

  const parsed = parseBlockTree(template.block_tree);
  if (!parsed.ok) {
    return (
      <PreviewNotice
        title="Template preview unavailable"
        message="The block tree failed validation."
      />
    );
  }

  return (
    <>
      <PreviewBanner templateName={template.name} />
      <BlockTreeRenderer
        tree={parsed.tree}
        client={clientProps}
        campaign={DEMO_CAMPAIGN}
      />
    </>
  );
}

// ── UI chrome ──────────────────────────────────────────────────────

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
