import { error, requireApiOperator, success } from "@/lib/api";
import { makeLandingTemplate } from "@/lib/landing";
import { replaceSlots, type SlotData, validateHtmlTemplate } from "@/lib/slots";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import { normaliseThemePalette } from "@/lib/theme-fields";
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

    const paletteResult = normaliseThemePalette(body.palette);
    if (!paletteResult.ok) {
      return error(
        paletteResult.key
          ? `palette.${paletteResult.key} must be a valid hex colour`
          : "palette must include all 11 colour tokens"
      );
    }

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
      return success({ html: replaceSlots(pastedLanding, SAMPLE) });
    }

    // No paste → render the palette-generated landing from the draft theme.
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
      palette: paletteResult.palette,
      fontDisplay:
        (typeof body.font_display === "string" && body.font_display.trim()) ||
        DEFAULT_EMAIL_THEME.fontDisplay,
      fontSans:
        (typeof body.font_sans === "string" && body.font_sans.trim()) ||
        DEFAULT_EMAIL_THEME.fontSans,
      logo: logoUrl
        ? { url: logoUrl, background: logoBackground, position: logoPosition }
        : null,
      // The form forces this true for gallery; reflect whatever it sends.
      showPoweredBy: body.show_powered_by !== false,
    };

    return success({ html: replaceSlots(makeLandingTemplate(theme), SAMPLE) });
  } catch (err) {
    console.error("POST /api/operator/themes/landing-preview error:", err);
    return error("Internal server error", 500);
  }
}
