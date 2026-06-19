import { db } from "@/db";
import { themes } from "@/db/schema";
import { eq } from "drizzle-orm";

// ── Campaign Themes — the single resolution point (CT1) ──────────────
//
// A theme is the baked look applied to a campaign's transactional emails (CT1)
// and, later, its landing page (CT4). This module owns the EmailTheme shape, the
// in-code default that reproduces today's TalentStream look byte-for-byte, the
// precedence resolver (campaign override → brand default → gallery/default), and
// the activation-time freeze. It is a PURE READ-SIDE resolver: it renders
// whatever theme it is handed and performs no tier-gating or availability checks
// (those live in the CT2/CT3 writers).

export interface EmailTheme {
  /** All values are CSS colour strings (hex). Keys mirror the in-app brand
   *  tokens; the email kit reads `theme.palette.x` wherever it used to read `C.x`. */
  palette: {
    bg: string;
    card: string;
    primary: string;
    primaryDeep: string;
    primaryTint: string;
    accent: string;
    ink: string;
    inkSoft: string;
    inkMuted: string;
    inkFaint: string;
    border: string;
  };
  fontDisplay: string;
  fontSans: string;
  /** When set, the brand header renders this logo as an <img>; when null, the
   *  TalentStream funnel wordmark is rendered (default-theme fallback). */
  logo: { url: string; background: string; position: string } | null;
  showPoweredBy: boolean;
}

/** The snapshot frozen onto a campaign at activation (RD-1). Stored on
 *  campaigns.theme_snapshot and preferred over a live resolve for active
 *  campaigns, so editing a theme never changes a campaign already in flight. */
export interface ThemeSnapshot {
  email: EmailTheme;
  landingHtml: string | null;
  theme_id: string | null;
  frozen_at: string;
}

// Font stacks — Google fonts aren't reliably loaded across email clients, so
// these stacks fall back to widely-available system equivalents that match the
// in-app feel (editorial serif headlines, clean sans body). Kept here (rather
// than in email.ts) so DEFAULT_EMAIL_THEME is the single source of truth and
// email.ts has no module-level font constants to drift from.
export const FONT_DISPLAY =
  "'Instrument Serif', Georgia, 'Times New Roman', 'DejaVu Serif', serif";
export const FONT_SANS =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Reproduces today's look EXACTLY — the cobalt/vermillion palette, the font
 * stacks, the TalentStream funnel wordmark (logo: null), and the powered-by
 * footer. The palette keys rename the old module-level `C` keys in email.ts
 * (cobalt→primary, vermillion→accent, …) but the hex values are identical, so
 * the refactor is mechanical and byte-identical. This constant is the default
 * rung of the resolver: no DB hit on the common path, and being a constant it is
 * trivially provable byte-identical against the committed email snapshot.
 */
export const DEFAULT_EMAIL_THEME: EmailTheme = {
  palette: {
    bg: "#f0f3f7",
    card: "#ffffff",
    primary: "#2c5bff",
    primaryDeep: "#1a45d4",
    primaryTint: "#e8eeff",
    accent: "#05dbd6",
    ink: "#11123c",
    inkSoft: "#2f3941",
    inkMuted: "#5a6b7a",
    inkFaint: "#9fb5c4",
    border: "#d1dce6",
  },
  fontDisplay: FONT_DISPLAY,
  fontSans: FONT_SANS,
  logo: null,
  showPoweredBy: true,
};

/** The minimal client shape the resolver needs: the brand default theme id plus
 *  the brand's own logo (adopted by gallery/default themes, decision 9). */
interface ResolverClient {
  default_theme_id: string | null;
  branding_logo_url: string | null;
  logo_background: string | null;
  logo_position: string | null;
}

/** The minimal campaign shape: its (optional) own theme override + the brand. */
interface ResolverCampaign {
  theme_id: string | null;
  client: ResolverClient | null;
}

/** A gallery/default theme has no baked logo, so it adopts the rendering brand's
 *  configured logo. A logo-less brand falls back to the funnel wordmark (null). */
function brandLogo(client: ResolverClient | null): EmailTheme["logo"] {
  if (!client?.branding_logo_url) return null;
  return {
    url: client.branding_logo_url,
    background: client.logo_background ?? "light",
    position: client.logo_position ?? "top-left",
  };
}

/**
 * Resolve the effective theme for a campaign. Precedence:
 *   campaign.theme_id → brand.default_theme_id → in-code DEFAULT_EMAIL_THEME.
 * A campaign is never themeless. A theme id that no longer resolves (deleted
 * between read and resolve) silently degrades up the chain rather than throwing.
 *
 * This is the live (draft) read path. Active campaigns read theme_snapshot.email
 * instead — see the render-preference rule at every call site.
 */
export async function resolveCampaignTheme(
  campaign: ResolverCampaign
): Promise<{ email: EmailTheme; landingHtml: string | null }> {
  const themeId = campaign.theme_id ?? campaign.client?.default_theme_id ?? null;

  if (themeId) {
    const row = await db.query.themes.findFirst({
      where: eq(themes.id, themeId),
    });
    if (row) {
      const email: EmailTheme = {
        palette: row.palette as EmailTheme["palette"],
        fontDisplay: row.font_display,
        fontSans: row.font_sans,
        // A bespoke theme bakes its own logo; a gallery theme (logo_url null)
        // adopts the rendering brand's logo.
        logo: row.logo_url
          ? {
              url: row.logo_url,
              background: row.logo_background,
              position: row.logo_position,
            }
          : brandLogo(campaign.client),
        showPoweredBy: row.show_powered_by,
      };
      return { email, landingHtml: row.landing_html ?? null };
    }
    // Row missing (deleted / set-null race) → fall through to the default rung.
  }

  // Default rung: today's look, with the brand's own logo adopted (so even a
  // Standard brand keeps its logo per the tier matrix). landingHtml null here.
  return {
    email: { ...DEFAULT_EMAIL_THEME, logo: brandLogo(campaign.client) },
    landingHtml: null,
  };
}

/**
 * Freeze the resolved look at activation (RD-1). Captures the live resolver's
 * email theme plus the EFFECTIVE landing — a tenant's html_template override
 * wins over the theme's landing_html and stays authoritative for the active
 * campaign (CT4 precedence, decision 7). Re-frozen on every into-active
 * transition; never re-frozen by an edit to an already-active campaign.
 */
export async function freezeCampaignTheme(
  campaign: ResolverCampaign & { html_template: string | null }
): Promise<ThemeSnapshot> {
  const resolved = await resolveCampaignTheme(campaign);
  return {
    email: resolved.email,
    landingHtml: campaign.html_template ?? resolved.landingHtml,
    theme_id: campaign.theme_id ?? null,
    frozen_at: new Date().toISOString(),
  };
}
