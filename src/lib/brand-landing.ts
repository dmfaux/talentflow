import { cache } from "react";
import { and, count, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, clients, organizations, themes } from "@/db/schema";
import {
  derivePalette,
  readableTextOn,
  DEFAULT_THEME_SEEDS,
  type DerivedPalette,
} from "@/lib/theme-colors";
import { fontImportsFor } from "@/lib/theme-fonts";

// ── Brand careers landing (public) ───────────────────────────────────
//
// The read-side for the public per-brand careers page at /c/[clientSlug]. It
// lists a brand's OPEN campaigns, paged 10 per page, with optional department /
// location / employment-type facets. It is PUBLIC by slug — like the campaign
// apply page, the tenant seam does not run here, so org lifecycle is enforced
// inline (a suspended/deleted org's careers page is frozen) and nothing is
// org-scoped.
//
// Theming is the "hybrid" resolution (decided with the operator): the brand's
// own colour columns derive a full, contrast-safe palette via derivePalette;
// the brand's default theme (when set) contributes the font pairing and, as a
// fallback, a logo. Everything degrades to the Signal Desk app defaults.

export const PAGE_SIZE = 10;

/** A brand colour seed left blank in the DB → the matching app-default channel. */
function seedOr(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

export interface BrandTheme {
  palette: DerivedPalette;
  /** Black or white, whichever is legible ON the brand primary (button text). */
  onPrimary: string;
  /** CSS font-family stacks for display / body. */
  fontDisplay: string;
  fontSans: string;
  /** Google Fonts @import URLs to load — empty when using the app's bundled
   *  fonts (the default look loads nothing extra). */
  fontImports: string[];
  /** Optional brand logo; null → the headline wordmark carries the brand name. */
  logo: { url: string; background: string; position: string } | null;
  /** White-label flag inherited from the brand's default theme (default true). */
  showPoweredBy: boolean;
}

export interface RoleListItem {
  slug: string;
  roleTitle: string;
  excerpt: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  closesAt: Date | null;
}

export interface BrandFacets {
  department: string[];
  location: string[];
  employmentType: string[];
}

export interface ActiveFilters {
  department: string | null;
  location: string | null;
  employmentType: string | null;
}

export type BrandLandingResult =
  | { kind: "not_found" }
  | { kind: "org_unavailable" }
  | {
      kind: "ok";
      brand: { name: string; slug: string };
      theme: BrandTheme;
      roles: RoleListItem[];
      facets: BrandFacets;
      filters: ActiveFilters;
      /** Open roles for this brand, ignoring the active filters. */
      totalOpen: number;
      /** Open roles matching the active filters. */
      totalFiltered: number;
      page: number;
      totalPages: number;
    };

/** Resolve the brand's effective look: a contrast-safe palette derived from the
 *  brand's colour columns (each blank channel → an app default), plus the font
 *  pairing and fallback logo from its default theme when one is set. */
async function resolveBrandTheme(brand: {
  branding_logo_url: string | null;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  brand_accent_color: string | null;
  logo_background: string | null;
  logo_position: string | null;
  default_theme_id: string | null;
}): Promise<BrandTheme> {
  const palette = derivePalette({
    primary: seedOr(brand.brand_primary_color, DEFAULT_THEME_SEEDS.primary),
    accent: seedOr(brand.brand_accent_color, DEFAULT_THEME_SEEDS.accent),
    bg: seedOr(brand.brand_secondary_color, DEFAULT_THEME_SEEDS.bg),
  });

  // Defaults: the app's bundled Instrument pairing (loaded by the root layout
  // via next/font, so no extra @import) and no theme logo.
  let fontDisplay = "var(--font-fraunces), Georgia, 'Times New Roman', serif";
  let fontSans =
    "var(--font-instrument-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  let fontImports: string[] = [];
  let themeLogo: BrandTheme["logo"] = null;
  let showPoweredBy = true;

  if (brand.default_theme_id) {
    const theme = await db.query.themes.findFirst({
      where: eq(themes.id, brand.default_theme_id),
    });
    if (theme) {
      fontDisplay = theme.font_display;
      fontSans = theme.font_sans;
      fontImports = fontImportsFor(theme.font_display_key, theme.font_body_key);
      showPoweredBy = theme.show_powered_by;
      if (theme.logo_url) {
        themeLogo = {
          url: theme.logo_url,
          background: theme.logo_background,
          position: theme.logo_position,
        };
      }
    }
  }

  // Prefer the brand's own configured logo; fall back to a bespoke theme's logo;
  // otherwise the masthead headline carries the brand name as the wordmark.
  const logo = brand.branding_logo_url
    ? {
        url: brand.branding_logo_url,
        background: brand.logo_background ?? "light",
        position: brand.logo_position ?? "top-left",
      }
    : themeLogo;

  return {
    palette,
    onPrimary: readableTextOn(palette.primary),
    fontDisplay,
    fontSans,
    fontImports,
    logo,
    showPoweredBy,
  };
}

/** Strip markdown to a plain-text snippet for a role card. */
function plainExcerpt(md: string | null | undefined, max = 168): string {
  if (!md?.trim()) return "";
  const text = md
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>+\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // bullets
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list markers
    .replace(/[*_~]/g, "") // emphasis marks
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/** Distinct, non-blank, alphabetically-sorted facet values. */
function uniqueSorted(values: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch the public careers landing for a brand. Wrapped in React `cache` so the
 * page render and `generateMetadata` share a single execution per request.
 *
 * "Open" = status 'active' AND within its publish window: campaign_start is
 * unset-or-past AND campaign_end is unset-or-future. Facets are computed over
 * the full open set (so a visitor can always pivot between them); a role missing
 * a facet field is simply excluded while that filter is active.
 */
export const getBrandLanding = cache(async function getBrandLanding(
  clientSlug: string,
  page: number,
  department: string | null,
  location: string | null,
  employmentType: string | null,
): Promise<BrandLandingResult> {
  const [brand] = await db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      is_active: clients.is_active,
      org_status: organizations.status,
      branding_logo_url: clients.branding_logo_url,
      brand_primary_color: clients.brand_primary_color,
      brand_secondary_color: clients.brand_secondary_color,
      brand_accent_color: clients.brand_accent_color,
      logo_background: clients.logo_background,
      logo_position: clients.logo_position,
      default_theme_id: clients.default_theme_id,
    })
    .from(clients)
    .innerJoin(organizations, eq(clients.org_id, organizations.id))
    .where(eq(clients.slug, clientSlug))
    .limit(1);

  // An inactive (deactivated) brand is not public — hide its existence.
  if (!brand || brand.is_active === false) return { kind: "not_found" };
  // Suspended/deleted org → freeze the careers page (mirrors the apply page).
  if (brand.org_status !== "active") return { kind: "org_unavailable" };

  const now = new Date();
  const openConds = [
    eq(campaigns.client_id, brand.id),
    eq(campaigns.status, "active"),
    or(isNull(campaigns.campaign_start), lte(campaigns.campaign_start, now)),
    or(isNull(campaigns.campaign_end), gte(campaigns.campaign_end, now)),
  ];

  // Facets + total-open from the full open set, independent of active filters.
  const facetRows = await db
    .select({
      department: campaigns.department,
      location: campaigns.location,
      employment_type: campaigns.employment_type,
    })
    .from(campaigns)
    .where(and(...openConds));

  const facets: BrandFacets = {
    department: uniqueSorted(facetRows.map((r) => r.department)),
    location: uniqueSorted(facetRows.map((r) => r.location)),
    employmentType: uniqueSorted(facetRows.map((r) => r.employment_type)),
  };
  const totalOpen = facetRows.length;

  // Only honour a filter that actually exists as a facet — an arbitrary
  // ?dept=xyz that matches nothing collapses to "no filter" rather than an
  // empty page with no way back.
  const filters: ActiveFilters = {
    department:
      department && facets.department.includes(department) ? department : null,
    location: location && facets.location.includes(location) ? location : null,
    employmentType:
      employmentType && facets.employmentType.includes(employmentType)
        ? employmentType
        : null,
  };

  const filterConds = [...openConds];
  if (filters.department)
    filterConds.push(eq(campaigns.department, filters.department));
  if (filters.location)
    filterConds.push(eq(campaigns.location, filters.location));
  if (filters.employmentType)
    filterConds.push(eq(campaigns.employment_type, filters.employmentType));

  const [{ value: totalFiltered }] = await db
    .select({ value: count() })
    .from(campaigns)
    .where(and(...filterConds));

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const rows = await db
    .select({
      slug: campaigns.slug,
      role_title: campaigns.role_title,
      role_description: campaigns.role_description,
      department: campaigns.department,
      location: campaigns.location,
      employment_type: campaigns.employment_type,
      salary_range_min: campaigns.salary_range_min,
      salary_range_max: campaigns.salary_range_max,
      campaign_end: campaigns.campaign_end,
    })
    .from(campaigns)
    .where(and(...filterConds))
    .orderBy(desc(campaigns.created_at))
    .limit(PAGE_SIZE)
    .offset(offset);

  const roles: RoleListItem[] = rows.map((r) => ({
    slug: r.slug,
    roleTitle: r.role_title,
    excerpt: plainExcerpt(r.role_description),
    department: r.department,
    location: r.location,
    employmentType: r.employment_type,
    salaryMin: r.salary_range_min,
    salaryMax: r.salary_range_max,
    closesAt: r.campaign_end,
  }));

  return {
    kind: "ok",
    brand: { name: brand.name, slug: brand.slug },
    theme: await resolveBrandTheme(brand),
    roles,
    facets,
    filters,
    totalOpen,
    totalFiltered,
    page: safePage,
    totalPages,
  };
});
