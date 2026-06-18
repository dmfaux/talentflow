import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ── Seam mocks (mirrors operator-isolation.itest.ts) ─────────────────
// getSession picks the caller; getActAsClaim drives operator act-as; the
// active-brand cookie is stubbed (these tests don't exercise brand narrowing).
// Everything else — tenantFromSession's S11 org-status gate, getApiTenant, the
// lifecycle routes, the audit writes, the worker gate — runs for real.
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
    getActiveBrandCookie: async () => null,
  };
});

// The worker's candidate-processing path is the gate's observable side effect —
// spy on it so we can assert it does NOT run for a non-active org.
const processSpy = vi.hoisted(() => ({ fn: vi.fn(async () => {}) }));
vi.mock("@/lib/process-candidate", () => ({
  processNewCandidate: processSpy.fn,
}));
// Apply / request-access may enqueue + email on the active path — stub both.
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
  chatTokens,
  clients,
  jobs,
  operatorAudit,
  organizations,
  users,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

import { getApiTenant } from "@/lib/api";
import { handleJob } from "@/lib/queue/worker";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as applyPost } from "@/app/api/apply/[clientSlug]/[campaignSlug]/route";
import { POST as requestAccess } from "@/app/api/chat/request-access/route";
import { POST as jobsProcess } from "@/app/api/jobs/process/route";
import { POST as suspendRoute } from "@/app/api/operator/organizations/[id]/suspend/route";
import { POST as restoreRoute } from "@/app/api/operator/organizations/[id]/restore/route";
import { POST as softDeleteRoute } from "@/app/api/operator/organizations/[id]/soft-delete/route";
import { POST as purgeRoute } from "@/app/api/operator/organizations/[id]/purge/route";

const RUN = !!process.env.DATABASE_URL;

// ── Helpers ──────────────────────────────────────────────────────────
function jsonReq(body?: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: {
      "x-forwarded-for": "203.0.113.9",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const idParam = (id: string) => ({ params: Promise.resolve({ id }) });
const applyParam = (clientSlug: string, campaignSlug: string) => ({
  params: Promise.resolve({ clientSlug, campaignSlug }),
});

type Session = {
  userId: string;
  orgId: string | null;
  orgRole: "owner" | "org_admin" | null;
  isOperator: boolean;
};
const login_ = (s: Session) => (sessionHolder.current = s);
const actAs = (operatorUserId: string, actingOrgId: string) =>
  (actAsHolder.claim = { operatorUserId, actingOrgId });
const stopActing = () => (actAsHolder.claim = null);

async function setStatus(orgId: string, status: string) {
  await db
    .update(organizations)
    .set({ status, suspended_at: null, deleted_at: null })
    .where(eq(organizations.id, orgId));
}

const fx = {
  orgA: "",
  orgB: "",
  brandA: "",
  campaignA: "",
  candA: "",
  ownerA: "",
  ownerB: "",
  operator: "",
};
const PW = bcrypt.hashSync("password123", 4);

describe.skipIf(!RUN)("S11 tenant lifecycle (DB-backed)", () => {
  beforeAll(async () => {
    // The login route signs a real admin_session (jose HS256) on the 200 path.
    process.env.ADMIN_AUTH_SECRET ||= "itest-admin-secret-please-ignore-32+ch";

    await db.delete(operatorAudit);
    await db.delete(jobs);
    await db.delete(candidates);
    await db.delete(campaigns);
    await db.delete(users);
    await db.delete(clients);
    await db.delete(organizations);

    [fx.orgA, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: "org-a", name: "Org A" },
          { slug: "org-b", name: "Org B" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "brand-a", name: "Brand A" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    [fx.campaignA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "campaign-a",
          role_title: "Role A",
          status: "active",
          gating_config: [],
          scoring_rubric: {},
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);

    [fx.candA] = (
      await db
        .insert(candidates)
        .values({
          org_id: fx.orgA,
          campaign_id: fx.campaignA,
          name: "Cand A",
          email: "cand-a@applicant.test",
          status: "new",
        })
        .returning({ id: candidates.id })
    ).map((c) => c.id);

    const [oa] = await db
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
    fx.ownerA = oa.id;

    const [ob] = await db
      .insert(users)
      .values({
        org_id: fx.orgB,
        org_role: "owner",
        is_operator: false,
        first_name: "Owner",
        last_name: "B",
        email: "owner@org-b.test",
        password_hash: PW,
      })
      .returning({ id: users.id });
    fx.ownerB = ob.id;

    const [op] = await db
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
    fx.operator = op.id;
  });

  afterEach(async () => {
    // Each test owns its statuses — reset to active for isolation.
    await setStatus(fx.orgA, "active");
    await setStatus(fx.orgB, "active");
    sessionHolder.current = null;
    actAsHolder.claim = null;
    processSpy.fn.mockClear();
  });

  afterAll(async () => {
    sessionHolder.current = null;
    actAsHolder.claim = null;
  });

  // 1. Seam enforcement — the headline acceptance.
  describe("seam gate", () => {
    it("suspended org → tenant blocked (403); operators exempt; org B unaffected", async () => {
      await setStatus(fx.orgA, "suspended");

      login_({ userId: fx.ownerA, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const blocked = await getApiTenant();
      expect(blocked.ctx).toBeNull();
      expect(blocked.response?.status).toBe(403);

      // At-rest operator — allowed (no effective org).
      stopActing();
      login_({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const opRest = await getApiTenant();
      expect(opRest.response).toBeNull();
      expect(opRest.ctx?.isOperator).toBe(true);

      // Operator ACTING on the suspended org — must still reach it.
      actAs(fx.operator, fx.orgA);
      login_({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const opActing = await getApiTenant();
      expect(opActing.response).toBeNull();
      expect(opActing.ctx?.effectiveOrgId).toBe(fx.orgA);
      stopActing();

      // Org B's owner is unaffected.
      login_({ userId: fx.ownerB, orgId: fx.orgB, orgRole: "owner", isOperator: false });
      const orgBOk = await getApiTenant();
      expect(orgBOk.response).toBeNull();
      expect(orgBOk.ctx?.effectiveOrgId).toBe(fx.orgB);
    });

    it("deleted org → tenant blocked (401)", async () => {
      await setStatus(fx.orgA, "deleted");
      login_({ userId: fx.ownerA, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const { ctx, response } = await getApiTenant();
      expect(ctx).toBeNull();
      expect(response?.status).toBe(401);
    });
  });

  // 2. Login fast-fail.
  describe("login gate", () => {
    it("active → 200, suspended → 403, deleted → 401", async () => {
      const creds = { email: "owner@org-a.test", password: "password123" };

      await setStatus(fx.orgA, "active");
      expect((await login(jsonReq(creds))).status).toBe(200);

      await setStatus(fx.orgA, "suspended");
      expect((await login(jsonReq(creds))).status).toBe(403);

      await setStatus(fx.orgA, "deleted");
      expect((await login(jsonReq(creds))).status).toBe(401);
    });
  });

  // 3. Public careers refusal.
  describe("public refusal", () => {
    it("apply → 503 suspended / 410 deleted; active → not 503/410", async () => {
      const body = { name: "X", email: "x@y.test", popia_consent: true, answers: {} };

      await setStatus(fx.orgA, "suspended");
      expect(
        (await applyPost(jsonReq(body), applyParam("brand-a", "campaign-a"))).status
      ).toBe(503);

      await setStatus(fx.orgA, "deleted");
      expect(
        (await applyPost(jsonReq(body), applyParam("brand-a", "campaign-a"))).status
      ).toBe(410);
    });

    it("request-access for a suspended org → enumeration-safe success, no token issued", async () => {
      await setStatus(fx.orgA, "suspended");
      const before = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(chatTokens)
        .where(eq(chatTokens.candidate_id, fx.candA));

      const res = await requestAccess(
        jsonReq({
          email: "cand-a@applicant.test",
          clientSlug: "brand-a",
          campaignSlug: "campaign-a",
        })
      );
      expect(res.status).toBe(200);
      const { success } = await res.json();
      expect(success).toBe(true);

      const after = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(chatTokens)
        .where(eq(chatTokens.candidate_id, fx.candA));
      expect(after[0].n).toBe(before[0].n); // no token created
    });
  });

  // 4. Lifecycle routes + audit + transition matrix.
  describe("lifecycle routes", () => {
    it("non-operator → 403", async () => {
      login_({ userId: fx.ownerA, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      expect((await suspendRoute(jsonReq(), idParam(fx.orgA))).status).toBe(403);
    });

    it("active→suspend→restore→soft_delete→restore, each audited", async () => {
      login_({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });

      const s = await suspendRoute(jsonReq(), idParam(fx.orgA));
      expect(s.status).toBe(200);
      expect((await s.json()).data.status).toBe("suspended");

      const r = await restoreRoute(jsonReq(), idParam(fx.orgA));
      expect((await r.json()).data.status).toBe("active");

      const d = await softDeleteRoute(jsonReq(), idParam(fx.orgA));
      expect((await d.json()).data.status).toBe("deleted");

      const r2 = await restoreRoute(jsonReq(), idParam(fx.orgA));
      expect((await r2.json()).data.status).toBe("active");

      for (const action of ["suspend", "restore", "soft_delete"]) {
        const row = await db.query.operatorAudit.findFirst({
          where: and(
            eq(operatorAudit.action, action),
            eq(operatorAudit.target_org_id, fx.orgA)
          ),
        });
        expect(row).toBeTruthy();
      }
    });

    it("rejects illegal transitions (409)", async () => {
      login_({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      // Restore an active org is an idempotent no-op (200), but suspend a
      // deleted org is illegal.
      await setStatus(fx.orgA, "deleted");
      expect((await suspendRoute(jsonReq(), idParam(fx.orgA))).status).toBe(409);
    });

    it("purge interlock: active org → 409 (must soft-delete first)", async () => {
      login_({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      await setStatus(fx.orgA, "active");
      const res = await purgeRoute(jsonReq({ confirm: "org-a" }), idParam(fx.orgA));
      expect(res.status).toBe(409);
      // Org A is untouched.
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, fx.orgA),
      });
      expect(org).toBeTruthy();
    });

    it("purge from deleted requires the exact slug (422 on mismatch)", async () => {
      login_({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      await setStatus(fx.orgA, "deleted");
      const bad = await purgeRoute(jsonReq({ confirm: "wrong" }), idParam(fx.orgA));
      expect(bad.status).toBe(422);
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, fx.orgA),
      });
      expect(org).toBeTruthy(); // not purged
    });
  });

  // 5. No job resurrection for a dead org.
  describe("no resurrection", () => {
    it("handleJob skips candidate-processing for a suspended org; restore resumes", async () => {
      await setStatus(fx.orgA, "suspended");
      await handleJob({ type: "candidate-processing", candidateId: fx.candA });
      expect(processSpy.fn).not.toHaveBeenCalled();

      await setStatus(fx.orgA, "active");
      await handleJob({ type: "candidate-processing", candidateId: fx.candA });
      expect(processSpy.fn).toHaveBeenCalledTimes(1);
    });

    it("backstop SELECT inserts no recovery job for a suspended org; restore recovers", async () => {
      // Make candA eligible for backstop recovery.
      await db
        .update(candidates)
        .set({ status: "gating_passed", gating_passed: true, cv_url: "cvs/x/y/z.pdf" })
        .where(eq(candidates.id, fx.candA));
      await db.delete(jobs);

      const countCandJobs = async () =>
        (
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(jobs)
            .where(
              and(
                eq(jobs.type, "candidate-processing"),
                sql`${jobs.payload}->>'candidateId' = ${fx.candA}`
              )
            )
        )[0].n;

      await setStatus(fx.orgA, "suspended");
      await jobsProcess(jsonReq(undefined, "POST"));
      expect(await countCandJobs()).toBe(0);

      await setStatus(fx.orgA, "active");
      await jobsProcess(jsonReq(undefined, "POST"));
      expect(await countCandJobs()).toBeGreaterThan(0);

      // Reset candidate state for other tests.
      await db
        .update(candidates)
        .set({ status: "new", gating_passed: null, cv_url: null })
        .where(eq(candidates.id, fx.candA));
      await db.delete(jobs);
    });
  });
});
