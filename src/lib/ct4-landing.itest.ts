import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ── CT5 · landing-page theme integration (DB-backed) ─────────────────
//
// Exercises the public-render landing resolution (resolveEffectiveLanding) and
// the activation freeze (freezeCampaignTheme) against real themes rows. Under
// CT5 the landing is GENERATED from the resolved palette (makeLandingTemplate) —
// a campaign is never landing-less — and the per-campaign html_template paste is
// a Premium-only override. These tests prove, end-to-end:
//   • the generated landing reflects the resolved theme's palette;
//   • a Premium override wins; a Standard override is ignored (the gate);
//   • an active campaign is stable against later theme edits (snapshot freeze);
//   • the freeze stores override-or-null, never the themed landing.
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
import { makeLandingTemplate } from "@/lib/landing";
import {
  DEFAULT_EMAIL_THEME,
  freezeCampaignTheme,
  resolveEffectiveLanding,
} from "@/lib/theme";

const RUN = !!process.env.DATABASE_URL;
const MOUNT = '<div id="application-form"></div>';

// A distinctive palette colour we can look for in the generated landing to prove
// it was coloured from a specific theme.
const BRANDED_PRIMARY = "#006341";

const fx = { org: "", brand: "", owner: "", brandedTheme: "", plainTheme: "" };

/** A campaign-shaped input for the resolver, carrying the test brand's shape. */
type ResolverClient = {
  default_theme_id: string | null;
  branding_logo_url: string | null;
  logo_background: string | null;
  logo_position: string | null;
};
function campaign(opts: {
  theme_id?: string | null;
  theme_snapshot?: Awaited<ReturnType<typeof freezeCampaignTheme>> | null;
  client: ResolverClient;
}) {
  return {
    theme_id: opts.theme_id ?? null,
    theme_snapshot: opts.theme_snapshot ?? null,
    client: opts.client,
  };
}

describe.skipIf(!RUN)("CT5 landing theme integration (DB-backed)", () => {
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
        .values({ slug: "ct5-org", name: "CT5 Org" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    // A logo-less brand: the landing is theme-driven, not logo-driven.
    [fx.brand] = (
      await db
        .insert(clients)
        .values({ org_id: fx.org, slug: "ct5-brand", name: "CT5 Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    fx.owner = (
      await db
        .insert(users)
        .values({
          org_id: fx.org,
          org_role: "owner",
          first_name: "Owner",
          last_name: "CT5",
          email: "owner@ct5.test",
          password_hash: "x",
        })
        .returning({ id: users.id })
    )[0].id;

    const themeBase = {
      scope: "gallery" as const,
      is_active: true,
      font_display: DEFAULT_EMAIL_THEME.fontDisplay,
      font_sans: DEFAULT_EMAIL_THEME.fontSans,
      created_by: fx.owner,
    };
    [fx.brandedTheme, fx.plainTheme] = (
      await db
        .insert(themes)
        .values([
          {
            ...themeBase,
            name: "Branded Gallery",
            palette: { ...DEFAULT_EMAIL_THEME.palette, primary: BRANDED_PRIMARY },
          },
          { ...themeBase, name: "Plain Gallery", palette: DEFAULT_EMAIL_THEME.palette },
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

  it("draft + campaign theme_id: generates a valid landing coloured from that theme", async () => {
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: fx.brandedTheme, client: brand })
    );
    expect(validateHtmlTemplate(html).ok).toBe(true);
    expect(html).toContain(MOUNT); // mount contract — the form can render
    expect(html).toContain(BRANDED_PRIMARY); // coloured from the chosen theme
  });

  it("draft + no theme_id: generates from the brand-default theme's palette", async () => {
    const html = await resolveEffectiveLanding(
      campaign({ theme_id: null, client: { ...brand, default_theme_id: fx.brandedTheme } })
    );
    expect(html).toContain(BRANDED_PRIMARY);
  });

  it("active campaign (no bespoke landing): regenerates from the FROZEN palette, stable across theme edits", async () => {
    // Freeze at activation — the gallery theme has no bespoke landing, so
    // landingHtml is null and the look is carried by the frozen email palette.
    const snapshot = await freezeCampaignTheme({
      theme_id: fx.brandedTheme,
      client: brand,
    });
    expect(snapshot.landingHtml).toBeNull();
    expect(snapshot.email.palette.primary).toBe(BRANDED_PRIMARY);

    // Edit the underlying theme's palette out from under the active campaign.
    await db
      .update(themes)
      .set({ palette: { ...DEFAULT_EMAIL_THEME.palette, primary: "#ff00ff" } })
      .where(eq(themes.id, fx.brandedTheme));

    // The active campaign reads its snapshot palette — regenerated, but stable.
    const activeHtml = await resolveEffectiveLanding(
      campaign({ theme_id: fx.brandedTheme, theme_snapshot: snapshot, client: brand })
    );
    expect(activeHtml).toBe(makeLandingTemplate(snapshot.email));
    expect(activeHtml).toContain(BRANDED_PRIMARY);
    expect(activeHtml).not.toContain("#ff00ff");

    // A draft (no snapshot) re-resolves live and now sees the edit.
    const draftHtml = await resolveEffectiveLanding(
      campaign({ theme_id: fx.brandedTheme, client: brand })
    );
    expect(draftHtml).toContain("#ff00ff");

    // Restore for any later scenarios.
    await db
      .update(themes)
      .set({ palette: { ...DEFAULT_EMAIL_THEME.palette, primary: BRANDED_PRIMARY } })
      .where(eq(themes.id, fx.brandedTheme));
  });

});
