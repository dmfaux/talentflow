import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ── CT4 · landing-page theme integration (DB-backed) ─────────────────
//
// Exercises the public-render landing resolution (resolveEffectiveLanding) and
// the activation freeze (freezeCampaignTheme) against a real themes row, so the
// resolver's landing_html return value and the snapshot>override>theme-default
// precedence are proven end-to-end, not just in the pure unit tests.
//
// ⚠️ *.itest.ts truncate ALL tables — run only against the throwaway
// interview_insider_test DB (npm run test:integration), never the dev DB.

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  memberships,
  operatorAudit,
  organizations,
  themes,
  usageEvents,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";

import { validateHtmlTemplate } from "@/lib/slots";
import {
  DEFAULT_EMAIL_THEME,
  freezeCampaignTheme,
  resolveEffectiveLanding,
} from "@/lib/theme";

const RUN = !!process.env.DATABASE_URL;
const MOUNT = '<div id="application-form"></div>';

// Two valid landings (mount point present, no <script>) — one baked into a
// theme, one a tenant override.
const THEME_LANDING = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><h1>{{campaign.role_title}}</h1>${MOUNT}</body></html>`;
const OVERRIDE_LANDING = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><h2>Bespoke</h2>${MOUNT}</body></html>`;
const EDITED_THEME_LANDING = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><h1>Edited {{campaign.role_title}}</h1>${MOUNT}</body></html>`;

// Both landings must satisfy the slot/mount contract CT2 enforces at authoring.
expect(validateHtmlTemplate(THEME_LANDING).ok).toBe(true);
expect(validateHtmlTemplate(OVERRIDE_LANDING).ok).toBe(true);

const fx = { org: "", brand: "", owner: "", withLanding: "", noLanding: "" };

/** A campaign-shaped input for the resolver, carrying the test brand's shape. */
type ResolverClient = {
  default_theme_id: string | null;
  branding_logo_url: string | null;
  logo_background: string | null;
  logo_position: string | null;
};
function campaign(opts: {
  theme_id?: string | null;
  html_template?: string | null;
  theme_snapshot?: Awaited<ReturnType<typeof freezeCampaignTheme>> | null;
  client: ResolverClient;
}) {
  return {
    theme_id: opts.theme_id ?? null,
    html_template: opts.html_template ?? null,
    theme_snapshot: opts.theme_snapshot ?? null,
    client: opts.client,
  };
}

describe.skipIf(!RUN)("CT4 landing theme integration (DB-backed)", () => {
  let brand: ResolverClient;

  beforeAll(async () => {
    await db.delete(usageEvents);
    await db.delete(operatorAudit);
    await db.delete(candidates);
    await db.delete(campaigns);
    await db.delete(memberships);
    await db.delete(themes);
    await db.delete(users);
    await db.delete(clients);
    await db.delete(organizations);

    [fx.org] = (
      await db
        .insert(organizations)
        .values({ slug: "ct4-org", name: "CT4 Org" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    // A logo-less brand: the landing resolution is theme-driven, not logo-driven.
    [fx.brand] = (
      await db
        .insert(clients)
        .values({ org_id: fx.org, slug: "ct4-brand", name: "CT4 Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    fx.owner = (
      await db
        .insert(users)
        .values({
          org_id: fx.org,
          org_role: "owner",
          first_name: "Owner",
          last_name: "CT4",
          email: "owner@ct4.test",
          password_hash: "x",
        })
        .returning({ id: users.id })
    )[0].id;

    const themeBase = {
      scope: "gallery" as const,
      is_active: true,
      palette: DEFAULT_EMAIL_THEME.palette,
      font_display: DEFAULT_EMAIL_THEME.fontDisplay,
      font_sans: DEFAULT_EMAIL_THEME.fontSans,
      created_by: fx.owner,
    };
    [fx.withLanding, fx.noLanding] = (
      await db
        .insert(themes)
        .values([
          { ...themeBase, name: "Gallery With Landing", landing_html: THEME_LANDING },
          { ...themeBase, name: "Gallery No Landing", landing_html: null },
        ])
        .returning({ id: themes.id })
    ).map((t) => t.id);

    brand = {
      default_theme_id: null,
      branding_logo_url: null,
      logo_background: "light",
      logo_position: "top-left",
    };
  });

  afterAll(async () => {
    // Leave the throwaway DB clean for the next suite.
    await db.delete(campaigns);
    await db.delete(themes);
    await db.delete(users);
    await db.delete(clients);
    await db.delete(organizations);
  });

  it("renders a theme's landing_html when there is no override (draft, campaign theme_id)", async () => {
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: fx.withLanding, client: brand })
    );
    expect(html).toBe(THEME_LANDING);
    expect(html).toContain(MOUNT); // mount contract — the form can render
  });

  it("inherits the landing from the brand-default theme when the campaign has no theme_id", async () => {
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: null, client: { ...brand, default_theme_id: fx.withLanding } })
    );
    expect(html).toBe(THEME_LANDING);
  });

  it("a tenant override wins over the theme's landing default", async () => {
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: fx.withLanding, html_template: OVERRIDE_LANDING, client: brand })
    );
    expect(html).toBe(OVERRIDE_LANDING);
  });

  it("an active campaign renders its frozen snapshot landing even after the theme's landing_html is edited", async () => {
    // Freeze the effective landing at activation (theme default, no override).
    const snapshot = await freezeCampaignTheme({
      theme_id: fx.withLanding,
      html_template: null,
      client: brand,
    });
    expect(snapshot.landingHtml).toBe(THEME_LANDING);

    // Edit the underlying theme's landing out from under the active campaign.
    await db
      .update(themes)
      .set({ landing_html: EDITED_THEME_LANDING })
      .where(eq(themes.id, fx.withLanding));

    // The active campaign is stable — it reads the snapshot, not the edited theme.
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: fx.withLanding, theme_snapshot: snapshot, client: brand })
    );
    expect(html).toBe(THEME_LANDING);
    expect(html).not.toBe(EDITED_THEME_LANDING);

    // A draft (no snapshot) re-resolves live and now sees the edit.
    const draftHtml = await resolveEffectiveLanding(
      campaign({ theme_id: fx.withLanding, client: brand })
    );
    expect(draftHtml).toBe(EDITED_THEME_LANDING);

    // Restore for any later scenarios.
    await db
      .update(themes)
      .set({ landing_html: THEME_LANDING })
      .where(eq(themes.id, fx.withLanding));
  });

  it("freezeCampaignTheme captures the effective landing — override over theme default", async () => {
    const overridden = await freezeCampaignTheme({
      theme_id: fx.withLanding,
      html_template: OVERRIDE_LANDING,
      client: brand,
    });
    expect(overridden.landingHtml).toBe(OVERRIDE_LANDING);

    const inherited = await freezeCampaignTheme({
      theme_id: fx.withLanding,
      html_template: null,
      client: brand,
    });
    expect(inherited.landingHtml).toBe(THEME_LANDING);
  });

  it("resolves to null when neither an override nor the theme supplies a landing", async () => {
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: fx.noLanding, client: { ...brand, default_theme_id: fx.noLanding } })
    );
    expect(html).toBeNull();
  });
});
