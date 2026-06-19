import { db } from "@/db";
import { clients } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant, success } from "@/lib/api";
import { assertThemeAvailableForBrand, resolveCampaignTheme } from "@/lib/theme";
import { makeLandingTemplate } from "@/lib/landing";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// ── CT5 · Themed landing — live preview ──────────────────────────────
//
// Backs the wizard's Landing Page step. Returns the slot-marked landing HTML
// that resolveCampaignTheme + makeLandingTemplate would produce for a (theme,
// brand) pair, so the wizard can drop it into its <iframe srcDoc> preview (the
// same TemplatePreview it uses for a pasted override). MUST be a server endpoint:
// theme.ts imports @/db, and resolveCampaignTheme reads the themes table — so the
// resolution can't run in the browser. The chosen theme is validated against the
// brand's availability before it is resolved, so a crafted theme_id can never
// render another brand's bespoke look.
//
// Read-only — no send, no metering, no tier gate (a Standard brand previews the
// SAME generated landing it will render; the tier gate only governs the optional
// html_template paste override, which this endpoint never touches).

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const body = await request.json().catch(() => ({}));

    // Brand: the active brand by default; an explicit brand_id (gated) lets the
    // edit-mode wizard preview against the campaign's own brand.
    const requested: string | null =
      typeof body.brand_id === "string" && body.brand_id.trim()
        ? body.brand_id.trim()
        : null;
    if (requested) {
      const denied = await authorizeApiBrand(ctx, requested, "viewer");
      if (denied) return denied;
    }
    const brandId = requested ?? ctx.activeBrandId;
    if (!brandId) return error("Select a brand first", 400);

    const brand = await db.query.clients.findFirst({
      where: and(eq(clients.id, brandId), eq(clients.org_id, ctx.effectiveOrgId!)),
      columns: {
        id: true,
        org_id: true,
        default_theme_id: true,
        branding_logo_url: true,
        logo_background: true,
        logo_position: true,
      },
    });
    if (!brand) return error("Brand not found", 404);

    // A chosen theme must be available to the brand; null inherits the brand
    // default (the resolver supplies the fallback). Validating before resolving
    // is what prevents a crafted id from rendering a foreign theme.
    let themeId: string | null = null;
    if (body.theme_id != null) {
      if (typeof body.theme_id !== "string" || !body.theme_id.trim()) {
        return error("theme_id must be a theme id or null");
      }
      const trimmed: string = body.theme_id.trim();
      const verdict = await assertThemeAvailableForBrand(trimmed, {
        id: brand.id,
        org_id: brand.org_id,
      });
      if (verdict) return error(verdict.message, verdict.status);
      themeId = trimmed;
    }

    const { email } = await resolveCampaignTheme({ theme_id: themeId, client: brand });
    return success({ html: makeLandingTemplate(email) });
  } catch (err) {
    console.error("POST /api/admin/themes/landing-preview error:", err);
    return error("Internal server error", 500);
  }
}
