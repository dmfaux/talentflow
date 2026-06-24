import { error, requireApiOperator, success } from "@/lib/api";
import { makeLandingTemplate } from "@/lib/landing";
import { replaceSlots, type SlotData, validateHtmlTemplate } from "@/lib/slots";
import { type EmailTheme } from "@/lib/theme";
import { normaliseThemeFields } from "@/lib/theme-fields";
import { fontImportsFor } from "@/lib/theme-fonts";
import { isLogoBackground, isLogoPosition } from "@/lib/utils";
import { NextRequest } from "next/server";

// ── CT6 · Bespoke landing — operator live preview ───────────────────
//
// The landing analogue of the operator email preview (POST
// /api/operator/themes/preview). Backs the theme-builder's Landing Page step so
// an operator authoring a bespoke (custom/Premium) theme sees the page candidates
// will get BEFORE the theme is saved. MUST be a server endpoint: makeLandingTemplate
// is pure, but it is paired here with the same draft→EmailTheme assembly the email
// preview uses, kept off the client for one render contract.
//
// Mirrors the tenant admin landing-preview (POST /api/admin/themes/landing-preview),
// but reads an UNSAVED draft rather than a stored (theme, brand) pair: the draft's
// own pasted landing_html wins when present (validated + slot-filled through the
// SAME pipeline a real page uses — validateHtmlTemplate / replaceSlots), else the
// palette-generated landing via makeLandingTemplate. No tier gate: bespoke is
// already brand-gated at write time (guardCustomThemeBrand); this is a read-only
// render and a Standard theme simply previews the generated landing it will get.

// Realistic campaign data so the slot-marked landing reads like a real posting.
// Optional fields are populated so their {{#…}} blocks render rather than vanish.
const SAMPLE: SlotData = {
  client: { name: "Northwind Studio" },
  campaign: {
    role_title: "Senior Software Engineer",
    role_description:
      "<p>Join a small, senior team shipping product that people rely on every day. You will own features end to end and help shape how we build.</p>",
    department: "Engineering",
    location: "Cape Town (Hybrid)",
    employment_type: "Full-time",
    salary_range_min: 750000,
    salary_range_max: 950000,
  },
};

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const body = await request.json();

    // Draw the brand's real name into the sample so the preview reads like this
    // brand's posting; fall back to the default stand-in when none is supplied.
    const clientName =
      typeof body.brand_name === "string" && body.brand_name.trim()
        ? body.brand_name.trim()
        : SAMPLE.client.name;
    const sample: SlotData = { ...SAMPLE, client: { name: clientName } };
    // Echoed back so the dialog's browser chrome can label the URL/role to match.
    const sampleMeta = {
      company: clientName,
      role: SAMPLE.campaign.role_title,
      department: SAMPLE.campaign.department,
      location: SAMPLE.campaign.location,
    };

    // A non-blank pasted landing wins; validate it against the SAME slot/mount
    // contract a real page must satisfy so a malformed draft returns a precise
    // 400 rather than rendering a formless page.
    const pastedLanding =
      typeof body.landing_html === "string" && body.landing_html.trim()
        ? body.landing_html
        : null;
    if (pastedLanding) {
      const check = validateHtmlTemplate(pastedLanding);
      if (!check.ok) return error(check.errors.join("; "));
      return success({
        html: replaceSlots(pastedLanding, sample),
        sample: sampleMeta,
      });
    }

    // No paste → render the generated landing from the draft theme: validate +
    // derive the whole draft through the SAME write-path contract (seeds→palette,
    // font keys→stacks/imports) so the generated page matches what a saved theme
    // would resolve to. The preview payload carries only render fields (no
    // scope/name/org); inject preview-only placeholders (none persisted). Scope
    // "custom" simply avoids the gallery org/client forcing — the generated
    // landing is identical regardless of scope.
    const result = normaliseThemeFields({
      ...body,
      scope: "custom",
      name: "Preview",
      org_id: "preview",
      client_id: "preview",
    });
    if (!result.ok) return error(result.message, result.status);
    const values = result.values;

    const logoUrl =
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? body.logo_url.trim()
        : null;
    const logoBackground = isLogoBackground(body.logo_background)
      ? body.logo_background
      : "light";
    const logoPosition = isLogoPosition(body.logo_position)
      ? body.logo_position
      : "top-left";

    const theme: EmailTheme = {
      palette: values.palette as EmailTheme["palette"],
      fontDisplay: values.font_display,
      fontSans: values.font_sans,
      logo: logoUrl
        ? { url: logoUrl, background: logoBackground, position: logoPosition }
        : null,
      // The form forces this true for gallery; reflect whatever it sends.
      showPoweredBy: values.show_powered_by,
      // The @import URLs makeLandingTemplate emits for the chosen web fonts.
      fontImports: fontImportsFor(values.font_display_key, values.font_body_key),
    };

    return success({
      html: replaceSlots(makeLandingTemplate(theme), sample),
      sample: sampleMeta,
    });
  } catch (err) {
    console.error("POST /api/operator/themes/landing-preview error:", err);
    return error("Internal server error", 500);
  }
}
