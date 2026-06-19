import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the themes lookup ───────────────────────────────────────────
// resolveCampaignTheme loads a theme by id via db.query.themes.findFirst. Back
// it with an id→row map and record the queried ids so precedence (which id the
// resolver actually looks up) is provable without a database. The queried id is
// recovered from the eq(themes.id, id) `where` clause's bound Param value.
const store = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  orgs: new Map<string, Record<string, unknown>>(),
  calls: [] as string[],
}));

// Recover the id bound into an `eq(col, id)` where-clause Param so a findFirst can
// be answered from an in-memory map without a database.
function paramId(arg: { where: unknown }): string {
  const chunks =
    (arg.where as { queryChunks?: { constructor?: { name?: string }; value?: unknown }[] })
      .queryChunks ?? [];
  const param = chunks.find((c) => c?.constructor?.name === "Param");
  return param?.value as string;
}

vi.mock("@/db", () => ({
  db: {
    query: {
      themes: {
        findFirst: async (arg: { where: unknown }) => {
          const id = paramId(arg);
          store.calls.push(id);
          return store.rows.get(id);
        },
      },
      organizations: {
        findFirst: async (arg: { where: unknown }) => store.orgs.get(paramId(arg)),
      },
    },
  },
}));

import {
  assertThemeAssignable,
  assertThemeAvailableForBrand,
  DEFAULT_EMAIL_THEME,
  FONT_DISPLAY,
  FONT_SANS,
  freezeCampaignTheme,
  resolveCampaignTheme,
} from "@/lib/theme";

// ── Fixtures ─────────────────────────────────────────────────────────

const BRANDED_PALETTE = {
  ...DEFAULT_EMAIL_THEME.palette,
  primary: "#006341",
  accent: "#b4c905",
};

/** A gallery-style row: no baked logo, default palette/fonts. */
function galleryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "gallery-1",
    palette: { ...DEFAULT_EMAIL_THEME.palette },
    font_display: FONT_DISPLAY,
    font_sans: FONT_SANS,
    logo_url: null,
    logo_background: "light",
    logo_position: "top-left",
    show_powered_by: true,
    landing_html: null,
    ...overrides,
  };
}

const logolessBrand = {
  default_theme_id: null,
  branding_logo_url: null,
  logo_background: null,
  logo_position: null,
};

const brandWithLogo = {
  default_theme_id: null,
  branding_logo_url: "https://cdn.example.com/acme-logo.png",
  logo_background: "dark",
  logo_position: "top-centre",
};

beforeEach(() => {
  store.rows.clear();
  store.orgs.clear();
  store.calls = [];
});

// ── Assignment guard (CT2) ───────────────────────────────────────────

describe("assertThemeAssignable", () => {
  it("allows a gallery theme on any brand regardless of tier", () => {
    expect(
      assertThemeAssignable({
        theme: { scope: "gallery", client_id: null },
        brandId: "brand-1",
        tier: "standard",
      })
    ).toEqual({ ok: true });
  });

  it("allows the brand's own bespoke theme when Premium+", () => {
    expect(
      assertThemeAssignable({
        theme: { scope: "custom", client_id: "brand-1" },
        brandId: "brand-1",
        tier: "premium",
      })
    ).toEqual({ ok: true });
  });

  it("rejects a custom theme on a Standard brand (400)", () => {
    const result = assertThemeAssignable({
      theme: { scope: "custom", client_id: "brand-1" },
      brandId: "brand-1",
      tier: "standard",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("hides another brand's bespoke theme as not-found (404)", () => {
    const result = assertThemeAssignable({
      theme: { scope: "custom", client_id: "brand-2" },
      brandId: "brand-1",
      tier: "enterprise",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

// ── Tenant write-side availability gate (CT3) ────────────────────────

describe("assertThemeAvailableForBrand", () => {
  const brand = { id: "B", org_id: "ORG" };

  it("allows a gallery theme on any brand/tier", async () => {
    store.rows.set("G", { id: "G", scope: "gallery", client_id: null, is_active: true });
    store.orgs.set("ORG", { tier: "standard" });
    expect(await assertThemeAvailableForBrand("G", brand)).toBeNull();
  });

  it("allows the brand's own bespoke when Premium+", async () => {
    store.rows.set("C", { id: "C", scope: "custom", client_id: "B", is_active: true });
    store.orgs.set("ORG", { tier: "premium" });
    expect(await assertThemeAvailableForBrand("C", brand)).toBeNull();
  });

  it("rejects the brand's own bespoke on a Standard org (400)", async () => {
    store.rows.set("C", { id: "C", scope: "custom", client_id: "B", is_active: true });
    store.orgs.set("ORG", { tier: "standard" });
    expect((await assertThemeAvailableForBrand("C", brand))?.status).toBe(400);
  });

  it("collapses a sibling brand's bespoke (operator 404) to a tenant 400", async () => {
    store.rows.set("C", { id: "C", scope: "custom", client_id: "OTHER", is_active: true });
    store.orgs.set("ORG", { tier: "enterprise" });
    expect((await assertThemeAvailableForBrand("C", brand))?.status).toBe(400);
  });

  it("rejects an inactive theme (400)", async () => {
    store.rows.set("G", { id: "G", scope: "gallery", client_id: null, is_active: false });
    store.orgs.set("ORG", { tier: "premium" });
    expect((await assertThemeAvailableForBrand("G", brand))?.status).toBe(400);
  });

  it("rejects a missing theme (400)", async () => {
    expect((await assertThemeAvailableForBrand("GONE", brand))?.status).toBe(400);
  });
});

// ── Precedence ───────────────────────────────────────────────────────

describe("resolveCampaignTheme — precedence", () => {
  it("prefers the campaign theme over the brand default", async () => {
    store.rows.set("T_CAMP", galleryRow({ id: "T_CAMP", palette: BRANDED_PALETTE }));
    store.rows.set("T_BRAND", galleryRow({ id: "T_BRAND" }));

    const { email } = await resolveCampaignTheme({
      theme_id: "T_CAMP",
      client: { ...logolessBrand, default_theme_id: "T_BRAND" },
    });

    expect(email.palette.primary).toBe("#006341");
    // Only the campaign theme was looked up — brand default never queried.
    expect(store.calls).toEqual(["T_CAMP"]);
  });

  it("falls back to the brand default when the campaign has no override", async () => {
    store.rows.set("T_BRAND", galleryRow({ id: "T_BRAND", palette: BRANDED_PALETTE }));

    const { email } = await resolveCampaignTheme({
      theme_id: null,
      client: { ...logolessBrand, default_theme_id: "T_BRAND" },
    });

    expect(email.palette.primary).toBe("#006341");
    expect(store.calls).toEqual(["T_BRAND"]);
  });

  it("falls through to DEFAULT_EMAIL_THEME with no DB hit when neither is set", async () => {
    const { email, landingHtml } = await resolveCampaignTheme({
      theme_id: null,
      client: logolessBrand,
    });

    expect(email).toEqual(DEFAULT_EMAIL_THEME);
    expect(landingHtml).toBeNull();
    expect(store.calls).toEqual([]); // hot path never touches the DB
  });

  it("degrades to the default rung when the theme id no longer resolves", async () => {
    // theme_id set but the row was deleted (set-null race) → no throw, default look.
    const { email, landingHtml } = await resolveCampaignTheme({
      theme_id: "GONE",
      client: logolessBrand,
    });

    expect(email.palette).toEqual(DEFAULT_EMAIL_THEME.palette);
    expect(email.logo).toBeNull();
    expect(landingHtml).toBeNull();
    expect(store.calls).toEqual(["GONE"]);
  });
});

// ── Logo resolution (decision 9: gallery logo is dynamic by force) ───

describe("resolveCampaignTheme — logo resolution", () => {
  it("a gallery theme adopts the rendering brand's logo", async () => {
    store.rows.set("G", galleryRow({ id: "G" }));

    const { email } = await resolveCampaignTheme({
      theme_id: "G",
      client: brandWithLogo,
    });

    expect(email.logo).toEqual({
      url: "https://cdn.example.com/acme-logo.png",
      background: "dark",
      position: "top-centre",
    });
  });

  it("a gallery theme on a logo-less brand falls back to the wordmark (null)", async () => {
    store.rows.set("G", galleryRow({ id: "G" }));

    const { email } = await resolveCampaignTheme({
      theme_id: "G",
      client: logolessBrand,
    });

    expect(email.logo).toBeNull();
  });

  it("a bespoke theme uses its own baked logo, ignoring the brand", async () => {
    store.rows.set(
      "B",
      galleryRow({
        id: "B",
        logo_url: "https://cdn.example.com/bespoke.png",
        logo_background: "light",
        logo_position: "top-left",
      })
    );

    const { email } = await resolveCampaignTheme({
      theme_id: "B",
      client: brandWithLogo, // brand has its own logo, but the bespoke one wins
    });

    expect(email.logo).toEqual({
      url: "https://cdn.example.com/bespoke.png",
      background: "light",
      position: "top-left",
    });
  });

  it("the default rung still adopts the brand logo (tier matrix)", async () => {
    const { email } = await resolveCampaignTheme({
      theme_id: null,
      client: brandWithLogo,
    });

    expect(email.palette).toEqual(DEFAULT_EMAIL_THEME.palette);
    expect(email.logo).toEqual({
      url: "https://cdn.example.com/acme-logo.png",
      background: "dark",
      position: "top-centre",
    });
    expect(store.calls).toEqual([]);
  });
});

// ── Row → EmailTheme mapping ─────────────────────────────────────────

describe("resolveCampaignTheme — row mapping", () => {
  it("maps palette/fonts/show_powered_by/landing_html off the row", async () => {
    store.rows.set(
      "T",
      galleryRow({
        id: "T",
        palette: BRANDED_PALETTE,
        font_display: "Custom Serif",
        font_sans: "Custom Sans",
        show_powered_by: false,
        landing_html: "<html>landing</html>",
      })
    );

    const { email, landingHtml } = await resolveCampaignTheme({
      theme_id: "T",
      client: logolessBrand,
    });

    expect(email.palette).toEqual(BRANDED_PALETTE);
    expect(email.fontDisplay).toBe("Custom Serif");
    expect(email.fontSans).toBe("Custom Sans");
    expect(email.showPoweredBy).toBe(false);
    expect(landingHtml).toBe("<html>landing</html>");
  });
});

// ── freezeCampaignTheme ──────────────────────────────────────────────

describe("freezeCampaignTheme", () => {
  it("email equals the live resolver's email", async () => {
    store.rows.set("T", galleryRow({ id: "T", palette: BRANDED_PALETTE }));
    const campaign = {
      theme_id: "T",
      html_template: null,
      client: brandWithLogo,
    };

    const snapshot = await freezeCampaignTheme(campaign);
    const live = await resolveCampaignTheme(campaign);

    expect(snapshot.email).toEqual(live.email);
  });

  it("landingHtml prefers html_template over the resolved landing (override present)", async () => {
    store.rows.set("T", galleryRow({ id: "T", landing_html: "<theme-landing>" }));

    const snapshot = await freezeCampaignTheme({
      theme_id: "T",
      html_template: "<tenant-override>",
      client: logolessBrand,
    });

    expect(snapshot.landingHtml).toBe("<tenant-override>");
  });

  it("landingHtml uses the resolved landing when there is no override", async () => {
    store.rows.set("T", galleryRow({ id: "T", landing_html: "<theme-landing>" }));

    const snapshot = await freezeCampaignTheme({
      theme_id: "T",
      html_template: null,
      client: logolessBrand,
    });

    expect(snapshot.landingHtml).toBe("<theme-landing>");
  });

  it("landingHtml is null at the default rung with no override", async () => {
    const snapshot = await freezeCampaignTheme({
      theme_id: null,
      html_template: null,
      client: logolessBrand,
    });

    expect(snapshot.landingHtml).toBeNull();
  });

  it("echoes theme_id and stamps an ISO frozen_at", async () => {
    store.rows.set("T", galleryRow({ id: "T" }));

    const snapshot = await freezeCampaignTheme({
      theme_id: "T",
      html_template: null,
      client: logolessBrand,
    });

    expect(snapshot.theme_id).toBe("T");
    expect(snapshot.frozen_at).toBe(new Date(snapshot.frozen_at).toISOString());
  });

  it("theme_id is null when the campaign has no override", async () => {
    const snapshot = await freezeCampaignTheme({
      theme_id: null,
      html_template: null,
      client: logolessBrand,
    });

    expect(snapshot.theme_id).toBeNull();
  });
});
