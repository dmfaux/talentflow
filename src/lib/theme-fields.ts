// ── Campaign Themes — theme-authoring field validation (CT2) ─────────
//
// PURE, db-free helpers shared by the operator theme routes (server) AND the
// theme-builder UI (client). Kept OUT of src/lib/theme.ts on purpose: that
// module imports `@/db`, so importing it into a client component would drag
// `postgres` into the browser bundle. Everything here depends only on the pure
// validators in `utils.ts` / `slots.ts`, so the builder can reuse the exact
// palette-key list and validation the server enforces — one contract, no drift.

import { validateHtmlTemplate } from "@/lib/slots";
import {
  EMAIL_TEMPLATE_TYPES,
  type EmailTemplateMap,
  isEmailTemplateType,
  validateEmailTemplate,
} from "@/lib/email-slots";
import {
  isLogoBackground,
  isLogoPosition,
  normaliseHexColor,
} from "@/lib/utils";

// The 11 palette tokens that make up an EmailTheme.palette (see EmailTheme in
// theme.ts). Order is the canonical authoring order used by the builder.
export const THEME_PALETTE_KEYS = [
  "bg",
  "card",
  "primary",
  "primaryDeep",
  "primaryTint",
  "accent",
  "ink",
  "inkSoft",
  "inkMuted",
  "inkFaint",
  "border",
] as const;

export type ThemePaletteKey = (typeof THEME_PALETTE_KEYS)[number];

// Starter draft for the builder — mirrors DEFAULT_EMAIL_THEME ("TalentStream
// Classic", today's look). Lives here (db-free) so the client builder can seed a
// blank theme without importing theme.ts (which pulls in @/db). Cosmetic only:
// the resolver's default rung is still the in-code DEFAULT_EMAIL_THEME constant.
export const STARTER_THEME_DRAFT = {
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
  } as Record<ThemePaletteKey, string>,
  font_display:
    "'Instrument Serif', Georgia, 'Times New Roman', 'DejaVu Serif', serif",
  font_sans:
    "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const;

export const THEME_SCOPES = ["gallery", "custom"] as const;
export type ThemeScope = (typeof THEME_SCOPES)[number];
export function isThemeScope(v: unknown): v is ThemeScope {
  return (
    typeof v === "string" && (THEME_SCOPES as readonly string[]).includes(v)
  );
}

// Tier gate for custom (white-label) themes (D-1). The authoritative tier lives
// on organizations.tier — clients.tier is a legacy mirror that is NEVER written
// (every brand defaults to "standard"), so theme gating must read the ORG tier.
export const PREMIUM_TIERS = ["premium", "enterprise"] as const;
export function isPremiumTier(v: unknown): boolean {
  return v === "premium" || v === "enterprise";
}

/**
 * Validate + normalise an 11-key theme palette. Every value must be a valid hex
 * colour (via normaliseHexColor); returns the normalised `#rrggbb` map, or the
 * first offending key so the caller can return a precise 400.
 */
export function normaliseThemePalette(
  input: unknown
):
  | { ok: true; palette: Record<ThemePaletteKey, string> }
  | { ok: false; key: ThemePaletteKey | null } {
  if (!input || typeof input !== "object") return { ok: false, key: null };
  const source = input as Record<string, unknown>;
  const palette = {} as Record<ThemePaletteKey, string>;
  for (const key of THEME_PALETTE_KEYS) {
    const normalised = normaliseHexColor(source[key]);
    if (!normalised) return { ok: false, key };
    palette[key] = normalised;
  }
  return { ok: true, palette };
}

/**
 * Validate + normalise the bespoke per-template email map (CT6). Accepts a
 * sparse object keyed by EmailTemplateType; each non-blank value must pass the
 * per-type email contract (validateEmailTemplate). Blank/absent entries are
 * dropped. Returns the normalised map (or null when empty), or the first error.
 */
export function normaliseEmailTemplates(
  input: unknown
):
  | { ok: true; templates: EmailTemplateMap | null }
  | { ok: false; message: string } {
  if (input == null) return { ok: true, templates: null };
  if (typeof input !== "object") {
    return { ok: false, message: "email_templates must be an object or null" };
  }
  const source = input as Record<string, unknown>;
  const out: EmailTemplateMap = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isEmailTemplateType(key)) {
      return {
        ok: false,
        message: `Unknown email template "${key}". Allowed: ${EMAIL_TEMPLATE_TYPES.join(", ")}`,
      };
    }
    if (value == null) continue;
    if (typeof value !== "string") {
      return { ok: false, message: `email_templates.${key} must be a string` };
    }
    if (!value.trim()) continue; // blank → no override for this type
    const check = validateEmailTemplate(key, value);
    if (!check.ok) {
      return { ok: false, message: `${key}: ${check.errors.join("; ")}` };
    }
    out[key] = value;
  }
  return {
    ok: true,
    templates: Object.keys(out).length ? out : null,
  };
}

// The full set of theme columns a create/edit produces, already normalised.
export interface ThemeWriteValues {
  name: string;
  scope: ThemeScope;
  org_id: string | null;
  client_id: string | null;
  palette: Record<ThemePaletteKey, string>;
  font_display: string;
  font_sans: string;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
  landing_html: string | null;
  email_templates: EmailTemplateMap | null;
  preview_image_url: string | null;
}

export type ThemeFieldsResult =
  | { ok: true; values: ThemeWriteValues }
  | { ok: false; status: 400; message: string };

function trimmedOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Normalise + validate a theme create/edit payload, enforcing the gallery/custom
 * invariants that hold on BOTH verbs (the PATCH route merges the existing row
 * with the body before calling this, so a scope flip re-validates here):
 *   - scope ∈ {gallery, custom}; name + 11 hex palette tokens + both fonts required.
 *   - GALLERY ⇒ org_id/client_id forced null and show_powered_by forced true (D-4).
 *   - CUSTOM  ⇒ org_id AND client_id required (the brand/org/tier integrity check
 *     itself needs a DB load and lives in the route, via guardCustomThemeBrand).
 *   - landing_html, when present, must satisfy the slot/mount contract.
 * Pure: no DB, so it is unit-testable in isolation.
 */
export function normaliseThemeFields(input: {
  name?: unknown;
  scope?: unknown;
  org_id?: unknown;
  client_id?: unknown;
  palette?: unknown;
  font_display?: unknown;
  font_sans?: unknown;
  logo_url?: unknown;
  logo_background?: unknown;
  logo_position?: unknown;
  show_powered_by?: unknown;
  landing_html?: unknown;
  email_templates?: unknown;
  preview_image_url?: unknown;
}): ThemeFieldsResult {
  const fail = (message: string): ThemeFieldsResult => ({
    ok: false,
    status: 400,
    message,
  });

  if (!isThemeScope(input.scope)) {
    return fail("scope must be 'gallery' or 'custom'");
  }
  const scope = input.scope;

  const name = trimmedOrNull(input.name);
  if (!name) return fail("name is required");

  const paletteResult = normaliseThemePalette(input.palette);
  if (!paletteResult.ok) {
    return fail(
      paletteResult.key
        ? `palette.${paletteResult.key} must be a valid hex colour`
        : "palette must include all 11 colour tokens"
    );
  }

  const font_display = trimmedOrNull(input.font_display);
  if (!font_display) return fail("font_display is required");
  const font_sans = trimmedOrNull(input.font_sans);
  if (!font_sans) return fail("font_sans is required");

  // Logo surface/position reuse the brand validators; default like the brand route.
  const logo_background = input.logo_background == null ? "light" : input.logo_background;
  if (!isLogoBackground(logo_background)) {
    return fail("logo_background must be 'light', 'dark', or 'transparent'");
  }
  const logo_position = input.logo_position == null ? "top-left" : input.logo_position;
  if (!isLogoPosition(logo_position)) {
    return fail("logo_position must be 'top-left' or 'top-centre'");
  }

  if (input.logo_url != null && typeof input.logo_url !== "string") {
    return fail("logo_url must be a string or null");
  }
  const logo_url = trimmedOrNull(input.logo_url);

  if (input.preview_image_url != null && typeof input.preview_image_url !== "string") {
    return fail("preview_image_url must be a string or null");
  }
  const preview_image_url = trimmedOrNull(input.preview_image_url);

  // landing_html (CT4 consumes) — an empty/absent value is allowed (no landing),
  // but any non-blank value must pass the form-mount + slot contract now so CT4
  // never renders a formless page.
  let landing_html: string | null = null;
  if (input.landing_html != null) {
    if (typeof input.landing_html !== "string") {
      return fail("landing_html must be a string or null");
    }
    if (input.landing_html.trim()) {
      const check = validateHtmlTemplate(input.landing_html);
      if (!check.ok) return fail(check.errors.join("; "));
      landing_html = input.landing_html;
    }
  }

  // email_templates (CT6) — per-template bespoke email HTML. Validated against
  // the per-type email contract; gallery themes are forced to null below.
  const emailResult = normaliseEmailTemplates(input.email_templates);
  if (!emailResult.ok) return fail(emailResult.message);
  let email_templates: EmailTemplateMap | null = emailResult.templates;

  if (input.show_powered_by != null && typeof input.show_powered_by !== "boolean") {
    return fail("show_powered_by must be a boolean");
  }
  // Default on; white-label (false) is only honoured for custom themes below.
  let show_powered_by = input.show_powered_by !== false;

  let org_id: string | null;
  let client_id: string | null;
  if (scope === "gallery") {
    // D-4: a gallery theme is global and always attributed.
    org_id = null;
    client_id = null;
    show_powered_by = true;
    // CT6: bespoke structure is custom/Premium-only. A gallery theme is the
    // Standard "pick from the set" surface and must stay recolour-only, so the
    // resolver can render landing_html / email_templates unconditionally knowing
    // only custom themes ever carry them.
    landing_html = null;
    email_templates = null;
  } else {
    org_id = trimmedOrNull(input.org_id);
    client_id = trimmedOrNull(input.client_id);
    if (!org_id || !client_id) {
      return fail("A custom theme requires both org_id and client_id");
    }
  }

  return {
    ok: true,
    values: {
      name,
      scope,
      org_id,
      client_id,
      palette: paletteResult.palette,
      font_display,
      font_sans,
      logo_url,
      logo_background,
      logo_position,
      show_powered_by,
      landing_html,
      email_templates,
      preview_image_url,
    },
  };
}
