import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Seam mocks ───────────────────────────────────────────────────────
// As in isolation.itest.ts, getSession is mocked to choose the caller. S7 adds
// two more seam fakes: getActAsClaim (the act-as resolution — drives whether the
// operator is "acting") and signActAsToken (so the impersonate route needs no
// ADMIN_AUTH_SECRET; the JWT verification path itself is unit-tested separately).
// Everything else — tenantFromSession, orgScope, requireApiOperator, the route
// bodies, the operator_audit writes — runs for real against the seeded DB.
const sessionHolder = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const actAsHolder = vi.hoisted(() => ({
  claim: null as { operatorUserId: string; actingOrgId: string } | null,
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => sessionHolder.current,
    getActAsClaim: async () => actAsHolder.claim,
    signActAsToken: async () => "test-act-as-token",
    // S8: tenantFromSession now reads the active-brand cookie every request.
    // These S7 tests don't exercise brand narrowing, so stub it to null —
    // otherwise the real one calls cookies() outside a request scope.
    getActiveBrandCookie: async () => null,
  };
});

// The campaign PATCH path may enqueue / email indirectly — stub both (matches
// isolation.itest.ts) so the act-as scoping assertion runs cleanly.
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
  clients,
  memberships,
  operatorAudit,
  organizations,
  users,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

import { ACT_AS_COOKIE } from "@/lib/auth";
import { resolveOwnedResource, tenantFromSession } from "@/lib/tenant";

import { GET as orgsList } from "@/app/api/operator/organizations/route";
import { PATCH as orgPatch } from "@/app/api/operator/organizations/[id]/route";
import { POST as impersonate } from "@/app/api/operator/impersonate/route";
import { POST as impersonateExit } from "@/app/api/operator/impersonate/exit/route";
import { PATCH as campaignPatch } from "@/app/api/admin/campaigns/[id]/route";

const RUN = !!process.env.DATABASE_URL;

// ── Request helpers ──────────────────────────────────────────────────
const IP = "203.0.113.7";
function jsonReq(body?: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: {
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
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
function actAs(operatorUserId: string, actingOrgId: string) {
  actAsHolder.claim = { operatorUserId, actingOrgId };
}
function stopActing() {
  actAsHolder.claim = null;
}

// ── Fixture ──────────────────────────────────────────────────────────
const fx = {
  orgA: "",
  orgB: "",
  brandA: "",
  brandB: "",
  campaignA: "",
  campaignB: "",
  owner: "",
  operator: "",
};
const PW = bcrypt.hashSync("password123", 4);

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

describe.skipIf(!RUN)("S7 operator console + act-as (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(operatorAudit);
    await db.delete(campaigns);
    await db.delete(memberships);
    await db.delete(users);
    await db.delete(clients);
    await db.delete(organizations);

    [fx.orgA, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: "org-a", name: "Org A" },
          { slug: "org-b", name: "Org B", status: "suspended" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "brand-a", name: "Brand A" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.brandB] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgB, slug: "brand-b", name: "Brand B" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    const [owner] = await db
      .insert(users)
      .values({
        org_id: fx.orgA,
        org_role: "owner",
        is_operator: false,
        first_name: "Owner",
        last_name: "A",
        email: "owner@org-a.test",
        password_hash: PW,
      })
      .returning({ id: users.id });
    fx.owner = owner.id;

    const [operator] = await db
      .insert(users)
      .values({
        org_id: null,
        org_role: null,
        is_operator: true,
        first_name: "Ops",
        last_name: "User",
        email: "operator@ops.test",
        password_hash: PW,
      })
      .returning({ id: users.id });
    fx.operator = operator.id;

    fx.campaignA = await seedCampaign(fx.orgA, fx.brandA, "campaign-a");
    fx.campaignB = await seedCampaign(fx.orgB, fx.brandB, "campaign-b");
  });

  afterAll(async () => {
    sessionHolder.current = null;
    actAsHolder.claim = null;
  });

  // 1. Console authz — operator-only, non-operators 403.
  describe("console authz", () => {
    it("tenant owner → 403 listing orgs", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await orgsList(jsonReq(undefined, "GET"));
      expect(res.status).toBe(403);
    });
    it("tenant owner → 403 impersonating", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await impersonate(jsonReq({ orgId: fx.orgA }));
      expect(res.status).toBe(403);
    });
    it("operator → lists all orgs", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await orgsList(jsonReq(undefined, "GET"));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.total).toBeGreaterThanOrEqual(2);
      const ids = data.organizations.map((o: { id: string }) => o.id);
      expect(ids).toContain(fx.orgA);
      expect(ids).toContain(fx.orgB);
    });
  });

  // 2. Deny-by-default — a non-acting operator reaches no tenant data.
  describe("non-acting operator", () => {
    it("resolveOwnedResource → null (orgScope FALSE)", async () => {
      stopActing();
      const ctx = await tenantFromSession({
        userId: fx.operator,
        orgId: null,
        orgRole: null,
        isOperator: true,
      });
      expect(ctx.effectiveOrgId).toBeNull();
      const row = await resolveOwnedResource(campaigns, fx.campaignA, ctx);
      expect(row).toBeNull();
    });
    it("admin write → 404", async () => {
      stopActing();
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await campaignPatch(jsonReq({ role_title: "x" }, "PATCH"), ctxParam(fx.campaignA));
      expect(res.status).toBe(404);
    });
  });

  // 3. Impersonate — sets the cookie + opens an audit row.
  describe("impersonate flow", () => {
    it("POST impersonate → cookie + open audit row", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await impersonate(jsonReq({ orgId: fx.orgA }));
      expect(res.status).toBe(200);
      expect(res.cookies.get(ACT_AS_COOKIE)?.value).toBe("test-act-as-token");

      const row = await db.query.operatorAudit.findFirst({
        where: and(
          eq(operatorAudit.operator_user_id, fx.operator),
          eq(operatorAudit.action, "impersonate"),
          eq(operatorAudit.target_org_id, fx.orgA)
        ),
      });
      expect(row).toBeTruthy();
      expect(row?.started_at).toBeTruthy();
      expect(row?.ended_at).toBeNull();
      expect(row?.ip).toBe(IP);
    });

    it("under act-as → reads exactly Org A; Org-B id → 404", async () => {
      actAs(fx.operator, fx.orgA);
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });

      const okA = await campaignPatch(jsonReq({ role_title: "Acted" }, "PATCH"), ctxParam(fx.campaignA));
      expect(okA.status).toBe(200);

      const denyB = await campaignPatch(jsonReq({ role_title: "x" }, "PATCH"), ctxParam(fx.campaignB));
      expect(denyB.status).toBe(404);
    });
  });

  // 4. Exit — clears the cookie + closes the open audit row.
  describe("exit", () => {
    it("POST exit → cookie cleared + audit row ended_at set", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await impersonateExit(jsonReq(undefined, "POST"));
      expect(res.status).toBe(200);
      const cookie = res.cookies.get(ACT_AS_COOKIE);
      expect(cookie?.value).toBe("");
      expect(cookie?.maxAge).toBe(0);

      const open = await db.query.operatorAudit.findFirst({
        where: and(
          eq(operatorAudit.operator_user_id, fx.operator),
          eq(operatorAudit.action, "impersonate"),
          isNull(operatorAudit.ended_at)
        ),
      });
      expect(open).toBeUndefined(); // every impersonate row is now closed
    });

    it("after exit → deny-by-default again", async () => {
      stopActing();
      const ctx = await tenantFromSession({
        userId: fx.operator,
        orgId: null,
        orgRole: null,
        isOperator: true,
      });
      const row = await resolveOwnedResource(campaigns, fx.campaignA, ctx);
      expect(row).toBeNull();
    });
  });

  // 5. Set tier — updates organizations.tier + audits {from,to}.
  describe("set tier", () => {
    it("PATCH tier → org updated + set_tier audit row", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await orgPatch(jsonReq({ tier: "premium" }, "PATCH"), ctxParam(fx.orgA));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.tier).toBe("premium");

      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, fx.orgA) });
      expect(org?.tier).toBe("premium");

      const audit = await db.query.operatorAudit.findFirst({
        where: and(
          eq(operatorAudit.operator_user_id, fx.operator),
          eq(operatorAudit.action, "set_tier"),
          eq(operatorAudit.target_org_id, fx.orgA)
        ),
      });
      expect(audit).toBeTruthy();
      const meta = audit?.metadata as { from?: string; to?: string } | null;
      expect(meta?.from).toBe("standard");
      expect(meta?.to).toBe("premium");
      expect(audit?.ip).toBe(IP);
      // point-in-time: started_at and ended_at both set
      expect(audit?.ended_at).toBeTruthy();
    });

    it("rejects an invalid tier", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await orgPatch(jsonReq({ tier: "platinum" }, "PATCH"), ctxParam(fx.orgA));
      expect(res.status).toBe(400);
    });
  });

  // 6. Suspended-org act-as is allowed (Resolved Decision 5).
  describe("suspended-org impersonation", () => {
    it("impersonating a suspended org succeeds + records status", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await impersonate(jsonReq({ orgId: fx.orgB }));
      expect(res.status).toBe(200);

      const row = await db.query.operatorAudit.findFirst({
        where: and(
          eq(operatorAudit.operator_user_id, fx.operator),
          eq(operatorAudit.action, "impersonate"),
          eq(operatorAudit.target_org_id, fx.orgB)
        ),
      });
      const meta = row?.metadata as { status?: string } | null;
      expect(meta?.status).toBe("suspended");
    });

    it("missing org → 404", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await impersonate(jsonReq({ orgId: "00000000-0000-0000-0000-000000000000" }));
      expect(res.status).toBe(404);
    });
  });

  // 7. Audit completeness — every audited action carries the actor, target, ip.
  describe("audit completeness", () => {
    it("all rows carry operator_user_id + target_org_id + ip", async () => {
      const rows = await db.query.operatorAudit.findMany({
        where: eq(operatorAudit.operator_user_id, fx.operator),
      });
      expect(rows.length).toBeGreaterThanOrEqual(3); // ≥ impersonate A, set_tier A, impersonate B
      for (const r of rows) {
        expect(r.operator_user_id).toBe(fx.operator);
        expect(r.target_org_id).toBeTruthy();
        expect(r.ip).toBe(IP);
      }
    });
  });
});
