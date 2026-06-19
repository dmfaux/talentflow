import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ── Session seam mock ────────────────────────────────────────────────
// getApiTenant → getSession() reads a cookie; in a DB test there is no request
// context, so mock getSession to return a chosen tenant + the active-brand
// cookie. The route bodies, RBAC, availability helper, and resolver all run for
// real against the throwaway database.
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

// The queue uses a dynamic require() vitest can't resolve. Email opens an SMTP
// socket — capture sends instead (keep the real template fns via …actual so the
// rendered HTML carries the resolved theme).
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));
const sent = vi.hoisted(() => ({
  calls: [] as { to: string; subject: string; html: string }[],
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendCandidateEmail: async () => null,
    sendTransactionalEmail: async (to: string, subject: string, html: string) => {
      sent.calls.push({ to, subject, html });
      return "msg-test-1";
    },
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
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { DEFAULT_EMAIL_THEME } from "@/lib/theme";
import { GET as themesGet } from "@/app/api/admin/themes/route";
import { POST as testSendPost } from "@/app/api/admin/themes/test-send/route";
import { POST as campaignsPost } from "@/app/api/admin/campaigns/route";
import { PATCH as campaignPatch } from "@/app/api/admin/campaigns/[id]/route";
import { PATCH as clientPatch } from "@/app/api/admin/clients/[id]/route";

const RUN = !!process.env.DATABASE_URL;
const PW = bcrypt.hashSync("password123", 4);

function jsonReq(body?: unknown, method = "POST", url = "http://localhost/api/test"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const idParam = (id: string) => ({ params: Promise.resolve({ id }) });

const BESPOKE_A1_PALETTE = {
  ...DEFAULT_EMAIL_THEME.palette,
  primary: "#006341",
  accent: "#b4c905",
};

const fx = {
  orgA: "", // premium
  orgB: "", // enterprise
  orgStd: "", // standard
  brandA1: "",
  brandA2: "", // sibling of A1 in orgA
  brandB: "", // orgB
  brandStd: "", // orgStd
  ownerA: "",
  recruiterA: "", // brand member (recruiter) of brandA1
  ownerStd: "",
  galleryG: "",
  galleryInactive: "",
  bespokeA1: "",
  bespokeA2: "", // foreign to A1 (sibling brand)
  bespokeB: "", // foreign to A1 (cross-org)
  bespokeStd: "", // custom on a Standard org
};

function loginOwnerA() {
  sessionHolder.current = { userId: fx.ownerA, orgId: fx.orgA, orgRole: "owner", isOperator: false };
  brandHolder.current = fx.brandA1;
}
function loginRecruiterA() {
  sessionHolder.current = { userId: fx.recruiterA, orgId: fx.orgA, orgRole: null, isOperator: false };
  brandHolder.current = fx.brandA1;
}
function loginOwnerStd() {
  sessionHolder.current = { userId: fx.ownerStd, orgId: fx.orgStd, orgRole: "owner", isOperator: false };
  brandHolder.current = fx.brandStd;
}

describe.skipIf(!RUN)("CT3 tenant theme picker (DB-backed)", () => {
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

    [fx.orgA, fx.orgB, fx.orgStd] = (
      await db
        .insert(organizations)
        .values([
          { slug: "ct3-orga", name: "Org A", tier: "premium" },
          { slug: "ct3-orgb", name: "Org B", tier: "enterprise" },
          { slug: "ct3-orgstd", name: "Org Std", tier: "standard" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA1, fx.brandA2, fx.brandB, fx.brandStd] = (
      await db
        .insert(clients)
        .values([
          { org_id: fx.orgA, slug: "ct3-a1", name: "Brand A1" },
          { org_id: fx.orgA, slug: "ct3-a2", name: "Brand A2" },
          { org_id: fx.orgB, slug: "ct3-b", name: "Brand B" },
          { org_id: fx.orgStd, slug: "ct3-std", name: "Brand Std" },
        ])
        .returning({ id: clients.id })
    ).map((c) => c.id);

    [fx.ownerA, fx.recruiterA, fx.ownerStd] = (
      await db
        .insert(users)
        .values([
          { org_id: fx.orgA, org_role: "owner", first_name: "Olivia", last_name: "A", email: "owner@ct3a.test", password_hash: PW },
          { org_id: fx.orgA, org_role: null, first_name: "Riley", last_name: "A", email: "recruiter@ct3a.test", password_hash: PW },
          { org_id: fx.orgStd, org_role: "owner", first_name: "Sam", last_name: "S", email: "owner@ct3std.test", password_hash: PW },
        ])
        .returning({ id: users.id })
    ).map((u) => u.id);

    await db
      .insert(memberships)
      .values({ user_id: fx.recruiterA, client_id: fx.brandA1, brand_role: "recruiter" });

    const themeBase = {
      font_display: DEFAULT_EMAIL_THEME.fontDisplay,
      font_sans: DEFAULT_EMAIL_THEME.fontSans,
      logo_background: "light",
      logo_position: "top-left",
      created_by: fx.ownerA,
    };

    [
      fx.galleryG,
      fx.galleryInactive,
      fx.bespokeA1,
      fx.bespokeA2,
      fx.bespokeB,
      fx.bespokeStd,
    ] = (
      await db
        .insert(themes)
        .values([
          { ...themeBase, name: "Gallery One", scope: "gallery", is_active: true, palette: DEFAULT_EMAIL_THEME.palette },
          { ...themeBase, name: "Gallery Retired", scope: "gallery", is_active: false, palette: DEFAULT_EMAIL_THEME.palette },
          { ...themeBase, name: "Brand A1 Bespoke", scope: "custom", is_active: true, org_id: fx.orgA, client_id: fx.brandA1, palette: BESPOKE_A1_PALETTE, logo_url: "https://cdn.example.com/a1.png", show_powered_by: false },
          { ...themeBase, name: "Brand A2 Bespoke", scope: "custom", is_active: true, org_id: fx.orgA, client_id: fx.brandA2, palette: DEFAULT_EMAIL_THEME.palette },
          { ...themeBase, name: "Brand B Bespoke", scope: "custom", is_active: true, org_id: fx.orgB, client_id: fx.brandB, palette: DEFAULT_EMAIL_THEME.palette },
          { ...themeBase, name: "Std Bespoke", scope: "custom", is_active: true, org_id: fx.orgStd, client_id: fx.brandStd, palette: DEFAULT_EMAIL_THEME.palette },
        ])
        .returning({ id: themes.id })
    ).map((t) => t.id);
  });

  afterAll(async () => {
    sessionHolder.current = null;
    brandHolder.current = null;
    sent.calls = [];
  });

  // ── GET /api/admin/themes — availability scoping ───────────────────
  describe("GET /api/admin/themes", () => {
    it("returns gallery ∪ the active brand's bespoke, excluding inactive/sibling/cross-org", async () => {
      loginOwnerA();
      const res = await themesGet(jsonReq(undefined, "GET", "http://localhost/api/admin/themes"));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      const ids = data.map((t: { id: string }) => t.id);

      expect(ids).toContain(fx.galleryG);
      expect(ids).toContain(fx.bespokeA1);
      expect(ids).not.toContain(fx.galleryInactive); // is_active = false
      expect(ids).not.toContain(fx.bespokeA2); // sibling brand
      expect(ids).not.toContain(fx.bespokeB); // cross-org
    });

    it("an explicit brand_id scopes to that in-org brand's bespoke", async () => {
      loginOwnerA();
      const res = await themesGet(
        jsonReq(undefined, "GET", `http://localhost/api/admin/themes?brand_id=${fx.brandA2}`)
      );
      expect(res.status).toBe(200);
      const { data } = await res.json();
      const ids = data.map((t: { id: string }) => t.id);
      expect(ids).toContain(fx.galleryG);
      expect(ids).toContain(fx.bespokeA2);
      expect(ids).not.toContain(fx.bespokeA1);
    });

    it("a cross-org brand_id is hidden (404), never leaking another org's themes", async () => {
      loginOwnerA();
      const res = await themesGet(
        jsonReq(undefined, "GET", `http://localhost/api/admin/themes?brand_id=${fx.brandB}`)
      );
      expect(res.status).toBe(404);
    });

    it("a same-org non-member brand_id is 404 for a plain member", async () => {
      loginRecruiterA(); // member of A1 only
      const res = await themesGet(
        jsonReq(undefined, "GET", `http://localhost/api/admin/themes?brand_id=${fx.brandA2}`)
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Campaign theme_id ──────────────────────────────────────────────
  describe("campaign theme_id availability", () => {
    it("accepts a gallery theme on create and persists it", async () => {
      loginOwnerA();
      const res = await campaignsPost(
        jsonReq({ slug: "camp-gallery", role_title: "Engineer", gating_config: [], scoring_rubric: {}, theme_id: fx.galleryG })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.theme_id).toBe(fx.galleryG);
    });

    it("accepts the brand's own bespoke theme", async () => {
      loginOwnerA();
      const res = await campaignsPost(
        jsonReq({ slug: "camp-bespoke", role_title: "Engineer", gating_config: [], scoring_rubric: {}, theme_id: fx.bespokeA1 })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.theme_id).toBe(fx.bespokeA1);
    });

    it("rejects a sibling brand's bespoke theme (400)", async () => {
      loginOwnerA();
      const res = await campaignsPost(
        jsonReq({ slug: "camp-foreign-sib", role_title: "Engineer", gating_config: [], scoring_rubric: {}, theme_id: fx.bespokeA2 })
      );
      expect(res.status).toBe(400);
    });

    it("rejects a cross-org bespoke theme (400)", async () => {
      loginOwnerA();
      const res = await campaignsPost(
        jsonReq({ slug: "camp-foreign-org", role_title: "Engineer", gating_config: [], scoring_rubric: {}, theme_id: fx.bespokeB })
      );
      expect(res.status).toBe(400);
    });

    it("rejects an inactive theme (400)", async () => {
      loginOwnerA();
      const res = await campaignsPost(
        jsonReq({ slug: "camp-inactive", role_title: "Engineer", gating_config: [], scoring_rubric: {}, theme_id: fx.galleryInactive })
      );
      expect(res.status).toBe(400);
    });

    it("null theme_id is valid and means inherit", async () => {
      loginOwnerA();
      const res = await campaignsPost(
        jsonReq({ slug: "camp-inherit", role_title: "Engineer", gating_config: [], scoring_rubric: {}, theme_id: null })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.theme_id).toBeNull();
    });

    it("PATCH sets a valid theme_id, rejects a foreign one, and clears to null", async () => {
      loginOwnerA();
      const createRes = await campaignsPost(
        jsonReq({ slug: "camp-patch", role_title: "Engineer", gating_config: [], scoring_rubric: {}, status: "draft" })
      );
      const { data: draft } = await createRes.json();

      const ok = await campaignPatch(jsonReq({ theme_id: fx.galleryG }, "PATCH"), idParam(draft.id));
      expect(ok.status).toBe(200);
      expect((await ok.json()).data.theme_id).toBe(fx.galleryG);

      const bad = await campaignPatch(jsonReq({ theme_id: fx.bespokeB }, "PATCH"), idParam(draft.id));
      expect(bad.status).toBe(400);

      const cleared = await campaignPatch(jsonReq({ theme_id: null }, "PATCH"), idParam(draft.id));
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).data.theme_id).toBeNull();
    });

    it("a publish PATCH that also sets theme_id freezes the new override", async () => {
      loginOwnerA();
      const createRes = await campaignsPost(
        jsonReq({ slug: "camp-publish-theme", role_title: "Engineer", gating_config: [], scoring_rubric: {}, status: "draft" })
      );
      const { data: draft } = await createRes.json();

      const res = await campaignPatch(
        jsonReq({ status: "active", theme_id: fx.bespokeA1 }, "PATCH"),
        idParam(draft.id)
      );
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.theme_snapshot).not.toBeNull();
      expect(data.theme_snapshot.theme_id).toBe(fx.bespokeA1);
      expect(data.theme_snapshot.email.palette.primary).toBe("#006341");
    });
  });

  // ── Brand default_theme_id ─────────────────────────────────────────
  describe("brand default_theme_id", () => {
    it("an owner sets and clears the brand default", async () => {
      loginOwnerA();
      const set = await clientPatch(jsonReq({ default_theme_id: fx.galleryG }, "PATCH"), idParam(fx.brandA1));
      expect(set.status).toBe(200);
      expect((await set.json()).data.default_theme_id).toBe(fx.galleryG);

      const clear = await clientPatch(jsonReq({ default_theme_id: null }, "PATCH"), idParam(fx.brandA1));
      expect(clear.status).toBe(200);
      expect((await clear.json()).data.default_theme_id).toBeNull();
    });

    it("a recruiter is forbidden from setting the brand default (403)", async () => {
      loginRecruiterA();
      const res = await clientPatch(jsonReq({ default_theme_id: fx.galleryG }, "PATCH"), idParam(fx.brandA1));
      expect(res.status).toBe(403);
    });

    it("a foreign theme as the brand default is rejected (400)", async () => {
      loginOwnerA();
      const res = await clientPatch(jsonReq({ default_theme_id: fx.bespokeA2 }, "PATCH"), idParam(fx.brandA1));
      expect(res.status).toBe(400);
    });

    it("a custom theme on a Standard brand is rejected by the tier gate (400)", async () => {
      loginOwnerStd();
      const res = await clientPatch(jsonReq({ default_theme_id: fx.bespokeStd }, "PATCH"), idParam(fx.brandStd));
      expect(res.status).toBe(400);
    });
  });

  // ── Test-send + preview ────────────────────────────────────────────
  describe("test-send + preview", () => {
    it("delivers a themed sample email to the caller without metering it", async () => {
      loginOwnerA();
      sent.calls = [];
      await db.delete(usageEvents);

      const res = await testSendPost(jsonReq({ theme_id: fx.bespokeA1 }));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.sent).toBe(true);
      expect(data.to).toBe("owner@ct3a.test");

      // One send, to the caller, carrying the bespoke palette.
      expect(sent.calls).toHaveLength(1);
      expect(sent.calls[0].to).toBe("owner@ct3a.test");
      expect(sent.calls[0].html).toContain("#006341");

      // Never metered (no email_sent usage row — sendTransactionalEmail bypasses
      // the candidate-email meter).
      const meter = await db.query.usageEvents.findFirst({
        where: eq(usageEvents.kind, "email_sent"),
      });
      expect(meter).toBeUndefined();
    });

    it("preview=1 returns rendered HTML without sending", async () => {
      loginOwnerA();
      sent.calls = [];
      const res = await testSendPost(
        jsonReq({ theme_id: fx.galleryG }, "POST", "http://localhost/api/admin/themes/test-send?preview=1")
      );
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(typeof data.html).toBe("string");
      expect(data.html.length).toBeGreaterThan(0);
      expect(sent.calls).toHaveLength(0);
    });

    it("rejects a foreign theme_id in a test-send (400)", async () => {
      loginOwnerA();
      const res = await testSendPost(jsonReq({ theme_id: fx.bespokeB }));
      expect(res.status).toBe(400);
    });
  });
});
