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
import {
  DEFAULT_EMAIL_THEME,
  freezeCampaignTheme,
  resolveCampaignTheme,
  type EmailTheme,
} from "@/lib/theme";
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
