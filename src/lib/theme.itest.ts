import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ── Session seam mock ────────────────────────────────────────────────
// getApiTenant → getSession() reads a cookie; in a DB test there is no request
// context, so mock getSession to return a chosen tenant and the active-brand
// cookie. Everything else (the route bodies, the freeze hook, the resolver)
// runs for real against the throwaway database.
const sessionHolder = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const brandHolder = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => sessionHolder.current,
    getActAsClaim: async () => null,
    getActiveBrandCookie: async () => brandHolder.current,
  };
});

// The queue uses a dynamic require() vitest can't resolve; email opens an SMTP
// socket. Stub both — keep the real template functions (…actual) so we can
// render with a resolved theme.
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendCandidateEmail: async () => null,
    sendTransactionalEmail: async () => null,
  };
});

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
import { NextRequest } from "next/server";

import { applicationReceivedEmail } from "@/lib/email";
import { makeLandingTemplate } from "@/lib/landing";
import {
  DEFAULT_EMAIL_THEME,
  freezeCampaignTheme,
  resolveCampaignTheme,
  resolveEffectiveLanding,
  type EmailTheme,
} from "@/lib/theme";
import type { EmailTemplateMap } from "@/lib/email-slots";
import { POST as campaignsPost } from "@/app/api/admin/campaigns/route";
import { PATCH as campaignPatch } from "@/app/api/admin/campaigns/[id]/route";

const RUN = !!process.env.DATABASE_URL;

function jsonReq(body?: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const ctxParam = (id: string) => ({ params: Promise.resolve({ id }) });

const PW = bcrypt.hashSync("password123", 4);

const BRANDED_PALETTE = {
  ...DEFAULT_EMAIL_THEME.palette,
  primary: "#006341",
  accent: "#b4c905",
};

const fx = {
  orgA: "",
  brandA: "",
  owner: "",
  bespokeTheme: "",
};

// The render path used everywhere: an active campaign prefers its frozen
// snapshot; a draft resolves live.
async function renderTheme(campaignId: string): Promise<EmailTheme> {
  const c = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, campaignId),
    with: { client: true },
  });
  if (!c) throw new Error("campaign not found");
  return c.theme_snapshot?.email ?? (await resolveCampaignTheme(c)).email;
}

describe.skipIf(!RUN)("CT1 theme freeze + render preference (DB-backed)", () => {
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

    [fx.orgA] = (
      await db
        .insert(organizations)
        .values({ slug: "org-theme", name: "Org Theme" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "brand-theme", name: "Brand Theme" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    fx.owner = (
      await db
        .insert(users)
        .values({
          org_id: fx.orgA,
          org_role: "owner",
          first_name: "Owner",
          last_name: "Theme",
          email: "owner@org-theme.test",
          password_hash: PW,
        })
        .returning({ id: users.id })
    )[0].id;

    // A bespoke (custom) theme owned by brand A: distinct palette, baked logo,
    // white-label footer.
    fx.bespokeTheme = (
      await db
        .insert(themes)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          name: "Brand A Bespoke",
          scope: "custom",
          is_active: true,
          palette: BRANDED_PALETTE,
          font_display: DEFAULT_EMAIL_THEME.fontDisplay,
          font_sans: DEFAULT_EMAIL_THEME.fontSans,
          logo_url: "https://cdn.example.com/brand-a.png",
          logo_background: "dark",
          logo_position: "top-centre",
          show_powered_by: false,
          created_by: fx.owner,
        })
        .returning({ id: themes.id })
    )[0].id;

    sessionHolder.current = {
      userId: fx.owner,
      orgId: fx.orgA,
      orgRole: "owner",
      isOperator: false,
    };
    brandHolder.current = fx.brandA;
  });

  afterAll(async () => {
    sessionHolder.current = null;
    brandHolder.current = null;
  });

  // Reset the brand default between scenarios.
  async function setBrandDefault(themeId: string | null) {
    await db
      .update(clients)
      .set({ default_theme_id: themeId })
      .where(eq(clients.id, fx.brandA));
  }

  it("create-active freezes the default look when the brand has no theme", async () => {
    await setBrandDefault(null);
    const res = await campaignsPost(
      jsonReq({
        slug: "active-default",
        role_title: "Engineer",
        status: "active",
        gating_config: [],
        scoring_rubric: {},
      })
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();

    expect(data.theme_snapshot).not.toBeNull();
    expect(data.theme_snapshot.email.palette.primary).toBe("#2c5bff");
    expect(data.theme_snapshot.email.logo).toBeNull();
    expect(data.theme_snapshot.email.showPoweredBy).toBe(true);
    expect(data.theme_snapshot.theme_id).toBeNull();
    expect(data.theme_snapshot.frozen_at).toBe(
      new Date(data.theme_snapshot.frozen_at).toISOString()
    );

    // Equals a live freeze against the same brand.
    const brand = await db.query.clients.findFirst({ where: eq(clients.id, fx.brandA) });
    const live = await freezeCampaignTheme({
      theme_id: null,
      html_template: null,
      client: brand!,
      tier: null, // email half is tier-independent; this test compares only .email
    });
    expect(data.theme_snapshot.email).toEqual(live.email);
  });

  it("create-active freezes the brand default theme (branded palette + logo, no powered-by)", async () => {
    await setBrandDefault(fx.bespokeTheme);
    const res = await campaignsPost(
      jsonReq({
        slug: "active-branded",
        role_title: "Engineer",
        status: "active",
        gating_config: [],
        scoring_rubric: {},
      })
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();

    const email = data.theme_snapshot.email as EmailTheme;
    expect(email.palette.primary).toBe("#006341");
    expect(email.showPoweredBy).toBe(false);
    expect(email.logo).toEqual({
      url: "https://cdn.example.com/brand-a.png",
      background: "dark",
      position: "top-centre",
    });

    // End-to-end render carries the brand palette + logo and drops the
    // TalentStream attribution.
    const html = applicationReceivedEmail(email, "Thabo", "Engineer", "Brand Theme");
    expect(html).toContain("#006341");
    expect(html).toContain('<img src="https://cdn.example.com/brand-a.png"');
    expect(html).not.toContain("Sent by TalentStream");
  });

  it("a draft is not frozen; draft→active PATCH freezes", async () => {
    await setBrandDefault(fx.bespokeTheme);
    const createRes = await campaignsPost(
      jsonReq({
        slug: "draft-then-active",
        role_title: "Engineer",
        status: "draft",
        gating_config: [],
        scoring_rubric: {},
      })
    );
    expect(createRes.status).toBe(201);
    const { data: draft } = await createRes.json();
    expect(draft.theme_snapshot).toBeNull();

    const patchRes = await campaignPatch(
      jsonReq({ status: "active" }, "PATCH"),
      ctxParam(draft.id)
    );
    expect(patchRes.status).toBe(200);
    const { data: activated } = await patchRes.json();
    expect(activated.theme_snapshot).not.toBeNull();
    expect(activated.theme_snapshot.email.palette.primary).toBe("#006341");
  });

  it("an active campaign renders from its snapshot even after the brand theme changes; a draft resolves live", async () => {
    await setBrandDefault(fx.bespokeTheme);

    // Active campaign — snapshot frozen to the bespoke palette.
    const activeRes = await campaignsPost(
      jsonReq({
        slug: "stable-active",
        role_title: "Engineer",
        status: "active",
        gating_config: [],
        scoring_rubric: {},
      })
    );
    const { data: active } = await activeRes.json();

    // Draft campaign — no snapshot, resolves live at render.
    const draftRes = await campaignsPost(
      jsonReq({
        slug: "live-draft",
        role_title: "Engineer",
        status: "draft",
        gating_config: [],
        scoring_rubric: {},
      })
    );
    const { data: draft } = await draftRes.json();

    // Now edit the underlying theme's palette out from under both.
    await db
      .update(themes)
      .set({ palette: { ...BRANDED_PALETTE, primary: "#111111" } })
      .where(eq(themes.id, fx.bespokeTheme));

    // Active reads the stable snapshot (old colour); draft re-resolves (new colour).
    expect((await renderTheme(active.id)).palette.primary).toBe("#006341");
    expect((await renderTheme(draft.id)).palette.primary).toBe("#111111");

    // Restore the theme palette for any later scenarios.
    await db
      .update(themes)
      .set({ palette: BRANDED_PALETTE })
      .where(eq(themes.id, fx.bespokeTheme));
  });

  it("editing an already-active campaign does not re-freeze the snapshot", async () => {
    await setBrandDefault(fx.bespokeTheme);
    const createRes = await campaignsPost(
      jsonReq({
        slug: "no-refreeze",
        role_title: "Engineer",
        status: "active",
        gating_config: [],
        scoring_rubric: {},
      })
    );
    const { data: created } = await createRes.json();
    const frozenAt = created.theme_snapshot.frozen_at;

    // Change the brand default, then edit a NON-status field on the active row.
    await setBrandDefault(null);
    const patchRes = await campaignPatch(
      jsonReq({ role_title: "Senior Engineer" }, "PATCH"),
      ctxParam(created.id)
    );
    expect(patchRes.status).toBe(200);
    const { data: edited } = await patchRes.json();

    // Snapshot is byte-stable — same frozen_at, same (branded) palette.
    expect(edited.theme_snapshot.frozen_at).toBe(frozenAt);
    expect(edited.theme_snapshot.email.palette.primary).toBe("#006341");
  });
});

// ── CT6 · bespoke landing + per-template emails (DB-backed) ──────────
//
// CT5 themed the landing from the palette and the per-campaign paste was the
// only bespoke surface. CT6 lets a CUSTOM (Premium) theme carry its OWN bespoke
// landing body (themes.landing_html) AND per-template email HTML
// (themes.email_templates). These cases prove, against real rows:
//   (a) draft precedence — campaign html_template paste > theme landing_html
//       > the palette-generated landing;
//   (b) freezeCampaignTheme bakes the theme's bespoke landing_html into
//       snapshot.landingHtml when there is no per-campaign paste override;
//   (c) the theme's email_templates ride onto snapshot.email.emailTemplates so
//       an active campaign sends the frozen bespoke emails (RD-1).
//
// ⚠️ *.itest.ts truncate ALL tables — run only against the throwaway
// interview_insider_test DB, never the dev DB.

const MOUNT = '<div id="application-form"></div>';

// The theme's own bespoke landing (a valid mount-bearing document) and a
// per-campaign paste override that must win over it.
const THEME_LANDING = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><h2>Theme Bespoke</h2>${MOUNT}</body></html>`;
const CAMPAIGN_PASTE = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><h2>Campaign Paste</h2>${MOUNT}</body></html>`;

// A valid per-type email map (CT6): applicationReceived needs no action.url;
// chatInvitation requires {{action.url}} or it would fail the per-type contract.
const THEME_EMAILS: EmailTemplateMap = {
  applicationReceived:
    "<p>Hi {{candidate.name}}, your application for {{campaign.role_title}} at {{client.name}} is received.</p>",
  chatInvitation:
    '<p>Hi {{candidate.name}}</p><a href="{{action.url}}">Start the chat</a>',
};

const ct6 = { org: "", brand: "", owner: "", customTheme: "" };

// A logo-less brand carrying the bespoke custom theme as its default. The shape
// matches ResolverClient (default_theme_id + the brand's own logo fields).
type ResolverBrand = {
  default_theme_id: string | null;
  branding_logo_url: string | null;
  logo_background: string | null;
  logo_position: string | null;
};

describe.skipIf(!RUN)("CT6 bespoke landing + email templates (DB-backed)", () => {
  let brand: ResolverBrand;

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

    [ct6.org] = (
      await db
        .insert(organizations)
        // Premium org — custom themes + paste overrides are Premium-only.
        .values({ slug: "ct6-org", name: "CT6 Org", tier: "premium" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [ct6.brand] = (
      await db
        .insert(clients)
        .values({ org_id: ct6.org, slug: "ct6-brand", name: "CT6 Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    ct6.owner = (
      await db
        .insert(users)
        .values({
          org_id: ct6.org,
          org_role: "owner",
          first_name: "Owner",
          last_name: "CT6",
          email: "owner@ct6.test",
          password_hash: PW,
        })
        .returning({ id: users.id })
    )[0].id;

    // A custom theme carrying BOTH a bespoke landing body and per-template emails.
    ct6.customTheme = (
      await db
        .insert(themes)
        .values({
          org_id: ct6.org,
          client_id: ct6.brand,
          name: "CT6 Bespoke",
          scope: "custom",
          is_active: true,
          palette: BRANDED_PALETTE,
          font_display: DEFAULT_EMAIL_THEME.fontDisplay,
          font_sans: DEFAULT_EMAIL_THEME.fontSans,
          show_powered_by: false,
          landing_html: THEME_LANDING,
          email_templates: THEME_EMAILS,
          created_by: ct6.owner,
        })
        .returning({ id: themes.id })
    )[0].id;

    brand = {
      default_theme_id: ct6.customTheme,
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

  it("(a) draft precedence: campaign paste > theme landing_html > generated", async () => {
    // 1. Campaign paste override (Premium) wins over the theme's own landing.
    const withPaste = await resolveEffectiveLanding({
      theme_id: ct6.customTheme,
      html_template: CAMPAIGN_PASTE,
      theme_snapshot: null,
      tier: "premium",
      client: brand,
    });
    expect(withPaste).toBe(CAMPAIGN_PASTE);

    // 2. No paste → the theme's bespoke landing_html is served verbatim.
    const themeLanding = await resolveEffectiveLanding({
      theme_id: ct6.customTheme,
      html_template: null,
      theme_snapshot: null,
      tier: "premium",
      client: brand,
    });
    expect(themeLanding).toBe(THEME_LANDING);

    // 3. A theme WITHOUT a bespoke landing falls through to the generated page.
    const [plainTheme] = (
      await db
        .insert(themes)
        .values({
          org_id: ct6.org,
          client_id: ct6.brand,
          name: "CT6 Plain Custom",
          scope: "custom",
          is_active: true,
          palette: BRANDED_PALETTE,
          font_display: DEFAULT_EMAIL_THEME.fontDisplay,
          font_sans: DEFAULT_EMAIL_THEME.fontSans,
          show_powered_by: false,
          landing_html: null,
          email_templates: null,
          created_by: ct6.owner,
        })
        .returning({ id: themes.id })
    ).map((t) => t.id);

    const generated = await resolveEffectiveLanding({
      theme_id: plainTheme,
      html_template: null,
      theme_snapshot: null,
      tier: "premium",
      client: { ...brand, default_theme_id: null },
    });
    expect(generated).not.toBe(THEME_LANDING);
    expect(generated).toContain(MOUNT); // generated landing still mounts the form
    expect(generated).toContain("#006341"); // coloured from the resolved palette
  });

  it("(b) freeze bakes the theme's bespoke landing_html when there is no paste", async () => {
    const snapshot = await freezeCampaignTheme({
      theme_id: ct6.customTheme,
      html_template: null, // no per-campaign override
      tier: "premium",
      client: brand,
    });
    expect(snapshot.landingHtml).toBe(THEME_LANDING);

    // A per-campaign paste still wins at freeze time (override beats theme body).
    const overridden = await freezeCampaignTheme({
      theme_id: ct6.customTheme,
      html_template: CAMPAIGN_PASTE,
      tier: "premium",
      client: brand,
    });
    expect(overridden.landingHtml).toBe(CAMPAIGN_PASTE);
  });

  it("(c) the custom theme's email_templates flow into snapshot.email.emailTemplates", async () => {
    const snapshot = await freezeCampaignTheme({
      theme_id: ct6.customTheme,
      html_template: null,
      tier: "premium",
      client: brand,
    });
    expect(snapshot.email.emailTemplates).toEqual(THEME_EMAILS);

    // The frozen snapshot regenerates the landing from the frozen body, stable
    // against later theme edits (RD-1) — the active campaign reads its snapshot.
    const activeHtml = await resolveEffectiveLanding({
      theme_id: ct6.customTheme,
      html_template: null,
      theme_snapshot: snapshot,
      tier: "premium",
      client: brand,
    });
    expect(activeHtml).toBe(THEME_LANDING);
    // Sanity: a snapshot without a frozen body would regenerate via the palette.
    expect(
      await resolveEffectiveLanding({
        theme_id: ct6.customTheme,
        html_template: null,
        theme_snapshot: { ...snapshot, landingHtml: null },
        tier: "premium",
        client: brand,
      })
    ).toBe(makeLandingTemplate(snapshot.email));
  });
});
