import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ── Seam mocks (mirror isolation.itest.ts) ───────────────────────────
// getApiTenant → getSession() + getActiveBrandCookie() read cookies; in a DB
// test there is no request scope, so back both with settable holders. Everything
// else (tenantFromSession, the guards, the route bodies) runs for real.
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

// Capture the invite email so the full invite→accept flow can extract the raw
// token (the create route only returns the row, never the secret).
const emailHolder = vi.hoisted(() => ({ lastHtml: null as string | null }));
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendCandidateEmail: async () => null,
    sendTransactionalEmail: async (_to: string, _s: string, html: string) => {
      emailHolder.lastHtml = html;
      return "stub-id";
    },
  };
});

import { db } from "@/db";
import {
  campaigns,
  clients,
  invitations,
  memberships,
  organizations,
  users,
} from "@/db/schema";
import { hashResetToken } from "@/lib/auth";
import { __resetRateLimits } from "@/lib/rate-limit";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";

import { POST as inviteCreate } from "@/app/api/admin/members/invite/route";
import { POST as inviteAccept } from "@/app/api/auth/invite/accept/route";
import { POST as setActiveBrand } from "@/app/api/admin/active-brand/route";
import { POST as campaignsPost, GET as campaignsGet } from "@/app/api/admin/campaigns/route";
import { GET as usersGet } from "@/app/api/admin/users/route";
import { GET as userGet } from "@/app/api/admin/users/[id]/route";
import { GET as clientsCheckSlug } from "@/app/api/admin/clients/check-slug/route";

const RUN = !!process.env.DATABASE_URL;

function jsonReq(body?: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const ctxParam = (id: string) => ({ params: Promise.resolve({ id }) });

type Session = {
  userId: string;
  orgId: string | null;
  orgRole: "owner" | "org_admin" | null;
  isOperator: boolean;
};
function login(s: Session) {
  sessionHolder.current = s;
}

// ── Fixture (own orgs, cleaned up — NOT a full-table wipe) ────────────
const SLUGS = {
  orgA: "s8inv-org-a",
  orgB: "s8inv-org-b",
  brandA1: "s8inv-brand-a1",
  brandA2: "s8inv-brand-a2",
  brandB: "s8inv-brand-b",
};
const fx = {
  orgA: "",
  orgB: "",
  brandA1: "",
  brandA2: "",
  brandB: "",
  owner: "",
  orgAdmin: "",
  recruiter: "",
  viewer: "",
  ownerB: "",
};
const PW = bcrypt.hashSync("password123", 4);
const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 1000);

async function cleanup() {
  await db
    .delete(organizations)
    .where(inArray(organizations.slug, [SLUGS.orgA, SLUGS.orgB]));
}

async function seedUser(
  orgId: string,
  email: string,
  orgRole: "owner" | "org_admin" | null
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      org_id: orgId,
      org_role: orgRole,
      is_operator: false,
      first_name: "Test",
      last_name: email.split("@")[0],
      email,
      password_hash: PW,
    })
    .returning({ id: users.id });
  return u.id;
}

async function seedCampaign(orgId: string, clientId: string, slug: string) {
  const [c] = await db
    .insert(campaigns)
    .values({
      org_id: orgId,
      client_id: clientId,
      slug,
      role_title: `Role ${slug}`,
      status: "draft",
      gating_config: [],
      scoring_rubric: {},
    })
    .returning({ id: campaigns.id });
  return c.id;
}

describe.skipIf(!RUN)("S8 invitations + brand context (DB-backed)", () => {
  beforeAll(async () => {
    await cleanup();

    [fx.orgA, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: SLUGS.orgA, name: "S8 Org A" },
          { slug: SLUGS.orgB, name: "S8 Org B" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA1, fx.brandA2] = (
      await db
        .insert(clients)
        .values([
          { org_id: fx.orgA, slug: SLUGS.brandA1, name: "Brand A1" },
          { org_id: fx.orgA, slug: SLUGS.brandA2, name: "Brand A2" },
        ])
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.brandB] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgB, slug: SLUGS.brandB, name: "Brand B" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    fx.owner = await seedUser(fx.orgA, "owner@s8inv-a.test", "owner");
    fx.orgAdmin = await seedUser(fx.orgA, "orgadmin@s8inv-a.test", "org_admin");
    fx.recruiter = await seedUser(fx.orgA, "recruiter@s8inv-a.test", null);
    fx.viewer = await seedUser(fx.orgA, "viewer@s8inv-a.test", null);
    fx.ownerB = await seedUser(fx.orgB, "owner@s8inv-b.test", "owner");

    await db.insert(memberships).values([
      { user_id: fx.recruiter, client_id: fx.brandA1, brand_role: "recruiter" },
      { user_id: fx.viewer, client_id: fx.brandA1, brand_role: "viewer" },
    ]);

    await seedCampaign(fx.orgA, fx.brandA1, "camp-a1");
    await seedCampaign(fx.orgA, fx.brandA2, "camp-a2");
  });

  afterAll(async () => {
    await cleanup();
    sessionHolder.current = null;
    brandHolder.current = null;
  });

  function tokenFromLastEmail(): string {
    const m = emailHolder.lastHtml?.match(/accept-invite\?token=([a-f0-9]+)/);
    if (!m) throw new Error("no accept token in captured email");
    return m[1];
  }

  // 1. Invite RBAC
  describe("invite RBAC", () => {
    it("recruiter → 403", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await inviteCreate(
        jsonReq({ email: "x1@s8inv-a.test", clientId: fx.brandA1, brandRole: "viewer" })
      );
      expect(res.status).toBe(403);
    });
    it("org_admin → 201 with a pending invitation row", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await inviteCreate(
        jsonReq({ email: "newbie@s8inv-a.test", clientId: fx.brandA1, brandRole: "recruiter" })
      );
      expect(res.status).toBe(201);
      const inv = await db.query.invitations.findFirst({
        where: and(eq(invitations.org_id, fx.orgA), eq(invitations.email, "newbie@s8inv-a.test")),
      });
      expect(inv?.accepted_at).toBeNull();
      expect(inv?.brand_role).toBe("recruiter");
      expect(inv?.token_hash).toBeTruthy();
    });
  });

  // 2. Accept happy path → recruiter limited to the chosen brand (acceptance)
  it("invite → accept → login yields a brand-scoped recruiter in Org A", async () => {
    login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
    const create = await inviteCreate(
      jsonReq({ email: "flow@s8inv-a.test", clientId: fx.brandA1, brandRole: "recruiter" })
    );
    expect(create.status).toBe(201);
    const token = tokenFromLastEmail();

    const res = await inviteAccept(
      jsonReq({ token, firstName: "Flow", lastName: "User", password: "password123" })
    );
    expect(res.status).toBe(200);
    // Session cookie minted (the invitee is logged in).
    expect(res.headers.get("set-cookie")).toContain("admin_session=");

    const user = await db.query.users.findFirst({
      where: and(eq(users.org_id, fx.orgA), eq(users.email, "flow@s8inv-a.test")),
    });
    expect(user).toBeTruthy();
    expect(user!.org_id).toBe(fx.orgA); // can't join another org
    expect(user!.org_role).toBeNull();
    const m = await db.query.memberships.findFirst({
      where: and(eq(memberships.user_id, user!.id), eq(memberships.client_id, fx.brandA1)),
    });
    expect(m?.brand_role).toBe("recruiter");
    const inv = await db.query.invitations.findFirst({
      where: and(eq(invitations.org_id, fx.orgA), eq(invitations.email, "flow@s8inv-a.test")),
    });
    expect(inv?.accepted_at).not.toBeNull(); // single-use burned
  });

  // 3. Org-level invite → empty-brand member (S9 bootstrap shape)
  it("org-level invite accepts with no brand membership + org_role", async () => {
    login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
    const create = await inviteCreate(
      jsonReq({ email: "orglevel@s8inv-a.test", orgRole: "org_admin" })
    );
    expect(create.status).toBe(201);
    const token = tokenFromLastEmail();
    const res = await inviteAccept(
      jsonReq({ token, firstName: "Org", lastName: "Level", password: "password123" })
    );
    expect(res.status).toBe(200);
    const user = await db.query.users.findFirst({
      where: and(eq(users.org_id, fx.orgA), eq(users.email, "orglevel@s8inv-a.test")),
    });
    expect(user!.org_role).toBe("org_admin");
    // Org-level bootstrap shape: no brand membership (users.client_id dropped S13).
    const m = await db.query.memberships.findFirst({
      where: eq(memberships.user_id, user!.id),
    });
    expect(m).toBeFalsy();
  });

  // 4. Token hardening
  describe("token hardening", () => {
    async function seedInvite(raw: string, opts: { expired?: boolean; accepted?: boolean }) {
      await db.insert(invitations).values({
        org_id: fx.orgA,
        email: `tok-${raw.slice(0, 6)}@s8inv-a.test`,
        client_id: fx.brandA1,
        brand_role: "viewer",
        token_hash: hashResetToken(raw),
        expires_at: opts.expired ? past : future,
        accepted_at: opts.accepted ? new Date() : null,
      });
    }
    it("expired → 400", async () => {
      await seedInvite("aaaa1111", { expired: true });
      const res = await inviteAccept(jsonReq({ token: "aaaa1111", firstName: "A", lastName: "B", password: "password123" }));
      expect(res.status).toBe(400);
    });
    it("already-accepted → 400", async () => {
      await seedInvite("bbbb2222", { accepted: true });
      const res = await inviteAccept(jsonReq({ token: "bbbb2222", firstName: "A", lastName: "B", password: "password123" }));
      expect(res.status).toBe(400);
    });
    it("unknown → 400", async () => {
      const res = await inviteAccept(jsonReq({ token: "deadbeef", firstName: "A", lastName: "B", password: "password123" }));
      expect(res.status).toBe(400);
    });
  });

  // 5. Existing-user guards (login resolvability)
  describe("existing-user guards", () => {
    it("inviting an email used in another org → 409 (global-email guard)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await inviteCreate(
        jsonReq({ email: "owner@s8inv-b.test", clientId: fx.brandA1, brandRole: "viewer" })
      );
      expect(res.status).toBe(409);
    });
    it("inviting an existing same-org member → 409", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await inviteCreate(
        jsonReq({ email: "recruiter@s8inv-a.test", clientId: fx.brandA1, brandRole: "viewer" })
      );
      expect(res.status).toBe(409);
    });
  });

  // 6. active-brand validation
  describe("POST /api/admin/active-brand", () => {
    it("member sets their own brand → success", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await setActiveBrand(jsonReq({ brandId: fx.brandA1 }));
      expect(res.status).toBe(200);
    });
    it("non-member brand (same org) → 403", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await setActiveBrand(jsonReq({ brandId: fx.brandA2 }));
      expect(res.status).toBe(403);
    });
    it("cross-org brand → 403", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await setActiveBrand(jsonReq({ brandId: fx.brandB }));
      expect(res.status).toBe(403);
    });
  });

  // 7. Brand-derived campaign create + brand-scoped reads
  describe("brand-derived campaigns", () => {
    it("no body client_id + active brand → 201 under that brand; body client_id ignored", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      brandHolder.current = fx.brandA1;
      const res = await campaignsPost(
        jsonReq({ client_id: fx.brandB, slug: "derived-1", role_title: "x", gating_config: [], scoring_rubric: {} })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.client_id).toBe(fx.brandA1);
      brandHolder.current = null;
    });
    it("no active brand → 400", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      brandHolder.current = null;
      const res = await campaignsPost(
        jsonReq({ slug: "derived-2", role_title: "x", gating_config: [], scoring_rubric: {} })
      );
      expect(res.status).toBe(400);
    });
    it("GET narrows to the active brand; cleared → all org campaigns", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      brandHolder.current = fx.brandA2;
      const narrowed = await campaignsGet(jsonReq(undefined, "GET"));
      const narrowedRows = (await narrowed.json()).data as { client_id: string }[];
      expect(narrowedRows.length).toBeGreaterThan(0);
      expect(narrowedRows.every((r) => r.client_id === fx.brandA2)).toBe(true);

      brandHolder.current = null;
      const all = await campaignsGet(jsonReq(undefined, "GET"));
      const allRows = (await all.json()).data as { client_id: string }[];
      const brandIds = new Set(allRows.map((r) => r.client_id));
      expect(brandIds.has(fx.brandA1)).toBe(true);
      expect(brandIds.has(fx.brandA2)).toBe(true);
    });
  });

  // 8. Members reads scoped (S4 carry-over closed)
  describe("members reads org-scoped", () => {
    it("GET users → only Org A non-operators, never Org B", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await usersGet();
      const rows = (await res.json()).data as { id: string; email: string }[];
      expect(rows.some((r) => r.id === fx.ownerB)).toBe(false);
      expect(rows.every((r) => r.email.endsWith("@s8inv-a.test"))).toBe(true);
    });
    it("GET users/[orgB-user] → 404", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await userGet(jsonReq(undefined, "GET"), ctxParam(fx.ownerB));
      expect(res.status).toBe(404);
    });
  });

  // 9. Slug oracle hardening
  describe("clients check-slug", () => {
    function slugReq(slug: string) {
      return new NextRequest(`http://localhost/api/admin/clients/check-slug?slug=${slug}`);
    }
    it("recruiter (no manage_brand) → 403", async () => {
      __resetRateLimits();
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await clientsCheckSlug(slugReq("anything"));
      expect(res.status).toBe(403);
    });
    it("org_admin: taken slug → generic unavailable, no cross-org detail", async () => {
      __resetRateLimits();
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await clientsCheckSlug(slugReq(SLUGS.brandB)); // brand B is Org B's
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.available).toBe(false);
      expect(JSON.stringify(body)).not.toContain(fx.orgB);
    });
    it("over the per-org limit → 429", async () => {
      __resetRateLimits();
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      let sawLimit = false;
      for (let i = 0; i < 12; i++) {
        const res = await clientsCheckSlug(slugReq(`probe-${i}`));
        if (res.status === 429) sawLimit = true;
      }
      expect(sawLimit).toBe(true);
    });
  });
});
