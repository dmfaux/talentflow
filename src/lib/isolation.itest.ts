import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ── Session seam mock ────────────────────────────────────────────────
// getApiTenant → getSession() reads a cookie; in a DB test there is no request
// context, so we mock getSession to return a chosen tenant. Everything else
// (tenantFromSession, orgScope, the guards, the route bodies) runs for real
// against the seeded database. vi.hoisted lets the factory close over a mutable
// holder that each test sets.
const sessionHolder = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: async () => sessionHolder.current };
});

// The queue uses a dynamic require() that vitest's loader can't resolve, and
// email opens an SMTP socket — both are side-effects irrelevant to isolation.
// Stub them so the public-write paths exercise the org_id stamping for real.
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({ enqueue: async () => {} }),
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendCandidateEmail: async () => null, sendTransactionalEmail: async () => null };
});

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  events,
  memberships,
  organizations,
  users,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { POST as campaignsPost } from "@/app/api/admin/campaigns/route";
import {
  DELETE as campaignDelete,
  PATCH as campaignPatch,
} from "@/app/api/admin/campaigns/[id]/route";
import { PATCH as candidatePatch } from "@/app/api/admin/candidates/[id]/route";
import { POST as clientsPost } from "@/app/api/admin/clients/route";
import { PATCH as clientPatch } from "@/app/api/admin/clients/[id]/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import {
  DELETE as userDelete,
  PATCH as userPatch,
} from "@/app/api/admin/users/[id]/route";
import { POST as passwordPost } from "@/app/api/admin/users/[id]/password/route";
import { POST as applyPost } from "@/app/api/apply/[clientSlug]/[campaignSlug]/route";
import { POST as eventsPost } from "@/app/api/events/route";
import {
  findAndPurgeExpiredCandidates,
  handleDataAccessRequest,
  handleDataDeletionRequest,
} from "@/lib/popia";

const RUN = !!process.env.DATABASE_URL;

// ── Request helpers ──────────────────────────────────────────────────
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

// ── Fixture ──────────────────────────────────────────────────────────
const fx = {
  orgA: "",
  orgB: "",
  brandA: "",
  brandB: "",
  campaignA: "",
  campaignB: "",
  candidateA: "",
  candidateB: "",
  owner: "",
  orgAdmin: "",
  brandAdmin: "",
  recruiter: "",
  viewer: "",
  ownerB: "",
  operator: "",
  popiaA: "",
  popiaB: "",
};

const PW = bcrypt.hashSync("password123", 4);
const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

async function seedUser(
  orgId: string | null,
  clientId: string,
  email: string,
  orgRole: "owner" | "org_admin" | null,
  isOperator = false
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      org_id: orgId,
      client_id: clientId,
      org_role: orgRole,
      is_operator: isOperator,
      first_name: "Test",
      last_name: email.split("@")[0],
      email,
      password_hash: PW,
      security_group: "user",
    })
    .returning({ id: users.id });
  return u.id;
}

async function seedCampaign(orgId: string, clientId: string, slug: string, status: string) {
  const [c] = await db
    .insert(campaigns)
    .values({
      org_id: orgId,
      client_id: clientId,
      slug,
      role_title: `Role ${slug}`,
      status,
      gating_config: [],
      scoring_rubric: {},
    })
    .returning({ id: campaigns.id });
  return c.id;
}

async function seedCandidate(
  orgId: string,
  campaignId: string,
  email: string,
  extra: Record<string, unknown> = {}
) {
  const [c] = await db
    .insert(candidates)
    .values({ org_id: orgId, campaign_id: campaignId, name: "Cand", email, ...extra })
    .returning({ id: candidates.id });
  return c.id;
}

describe.skipIf(!RUN)("S5 write-isolation & RBAC (DB-backed)", () => {
  beforeAll(async () => {
    // Clean slate (dependency order) so the fixture is idempotent across runs.
    await db.delete(events);
    await db.delete(candidates);
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
    [fx.brandB] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgB, slug: "brand-b", name: "Brand B" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    // Org A: the five roles. owner/org_admin carry org_role; brand_admin/
    // recruiter/viewer are plain members with a per-brand membership on brand A.
    fx.owner = await seedUser(fx.orgA, fx.brandA, "owner@org-a.test", "owner");
    fx.orgAdmin = await seedUser(fx.orgA, fx.brandA, "orgadmin@org-a.test", "org_admin");
    fx.brandAdmin = await seedUser(fx.orgA, fx.brandA, "brandadmin@org-a.test", null);
    fx.recruiter = await seedUser(fx.orgA, fx.brandA, "recruiter@org-a.test", null);
    fx.viewer = await seedUser(fx.orgA, fx.brandA, "viewer@org-a.test", null);
    fx.operator = await seedUser(null, fx.brandA, "operator@ops.test", null, true);
    // Org B owner (cross-org target).
    fx.ownerB = await seedUser(fx.orgB, fx.brandB, "owner@org-b.test", "owner");

    await db.insert(memberships).values([
      { user_id: fx.brandAdmin, client_id: fx.brandA, brand_role: "brand_admin" },
      { user_id: fx.recruiter, client_id: fx.brandA, brand_role: "recruiter" },
      { user_id: fx.viewer, client_id: fx.brandA, brand_role: "viewer" },
    ]);

    fx.campaignA = await seedCampaign(fx.orgA, fx.brandA, "campaign-a", "active");
    fx.campaignB = await seedCampaign(fx.orgB, fx.brandB, "campaign-b", "draft");

    fx.candidateA = await seedCandidate(fx.orgA, fx.campaignA, "cand-a@x.test");
    fx.candidateB = await seedCandidate(fx.orgB, fx.campaignB, "cand-b@x.test", {
      data_purge_at: future,
    });

    // POPIA: same email across both orgs, both expired.
    fx.popiaA = await seedCandidate(fx.orgA, fx.campaignA, "shared@popia.test", {
      data_purge_at: past,
    });
    fx.popiaB = await seedCandidate(fx.orgB, fx.campaignB, "shared@popia.test", {
      data_purge_at: past,
    });
  });

  afterAll(async () => {
    sessionHolder.current = null;
  });

  // 1. Cross-org valid UUID → 404 (indistinguishable from missing).
  describe("cross-org writes → 404", () => {
    it("campaign PATCH on another org's campaign", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await campaignPatch(jsonReq({ role_title: "x" }, "PATCH"), ctxParam(fx.campaignB));
      expect(res.status).toBe(404);
    });
    it("campaign DELETE on another org's campaign", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await campaignDelete(jsonReq(undefined, "DELETE"), ctxParam(fx.campaignB));
      expect(res.status).toBe(404);
    });
    it("candidate PATCH on another org's candidate", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await candidatePatch(jsonReq({ shortlist_notes: "x" }, "PATCH"), ctxParam(fx.candidateB));
      expect(res.status).toBe(404);
    });
    it("client PATCH on another org's brand", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await clientPatch(jsonReq({ name: "x" }, "PATCH"), ctxParam(fx.brandB));
      expect(res.status).toBe(404);
    });
    it("user PATCH on another org's user", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await userPatch(jsonReq({ firstName: "x" }, "PATCH"), ctxParam(fx.ownerB));
      expect(res.status).toBe(404);
    });
    it("password POST on another org's user", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await passwordPost(
        jsonReq({ password: "newpassword1", confirmPassword: "newpassword1" }),
        ctxParam(fx.ownerB)
      );
      expect(res.status).toBe(404);
    });
  });

  // 2. Body scope never widens the actor's reach.
  describe("body-scope escape rejected", () => {
    it("campaign POST with a foreign client_id → 404", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await campaignsPost(
        jsonReq({
          client_id: fx.brandB,
          slug: "x-foreign",
          role_title: "x",
          gating_config: [],
          scoring_rubric: {},
        })
      );
      expect(res.status).toBe(404);
    });
    it("client POST ignores body id/org_id; binds actor org", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const injectedId = "11111111-1111-1111-1111-111111111111";
      const res = await clientsPost(
        jsonReq({ id: injectedId, org_id: fx.orgB, name: "Injected", slug: "injected" })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.org_id).toBe(fx.orgA);
      expect(data.id).not.toBe(injectedId);
    });
    it("user POST with a foreign clientId → 404", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await usersPost(
        jsonReq({
          firstName: "A",
          lastName: "B",
          email: "foreign-brand@org-a.test",
          password: "password123",
          clientId: fx.brandB,
          brandRole: "recruiter",
        })
      );
      expect(res.status).toBe(404);
    });
    it("org_admin cannot grant an org_role above their own", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await usersPost(
        jsonReq({
          firstName: "A",
          lastName: "B",
          email: "escalate@org-a.test",
          password: "password123",
          clientId: fx.brandA,
          brandRole: "recruiter",
          orgRole: "owner",
        })
      );
      expect(res.status).toBe(403);
    });
  });

  // 3. Role matrix.
  describe("role matrix", () => {
    it("viewer → 403 creating a campaign", async () => {
      login({ userId: fx.viewer, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await campaignsPost(
        jsonReq({ client_id: fx.brandA, slug: "viewer-x", role_title: "x", gating_config: [], scoring_rubric: {} })
      );
      expect(res.status).toBe(403);
    });
    it("viewer → 403 editing a candidate", async () => {
      login({ userId: fx.viewer, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await candidatePatch(jsonReq({ shortlist_notes: "x" }, "PATCH"), ctxParam(fx.candidateA));
      expect(res.status).toBe(403);
    });
    it("viewer → 403 publishing a campaign", async () => {
      login({ userId: fx.viewer, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await campaignPatch(jsonReq({ status: "active" }, "PATCH"), ctxParam(fx.campaignA));
      expect(res.status).toBe(403);
    });
    it("recruiter → manages a candidate (200)", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await candidatePatch(jsonReq({ shortlist_notes: "noted" }, "PATCH"), ctxParam(fx.candidateA));
      expect(res.status).toBe(200);
    });
    it("recruiter → creates/publishes a campaign (201)", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await campaignsPost(
        jsonReq({ client_id: fx.brandA, slug: "recruiter-x", role_title: "x", status: "active", gating_config: [], scoring_rubric: {} })
      );
      expect(res.status).toBe(201);
    });
    it("recruiter → 403 creating a brand (org-level)", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await clientsPost(jsonReq({ name: "Nope", slug: "nope-r" }));
      expect(res.status).toBe(403);
    });
    it("brand_admin → 403 managing members (org-level)", async () => {
      login({ userId: fx.brandAdmin, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await usersPost(
        jsonReq({ firstName: "A", lastName: "B", email: "ba-x@org-a.test", password: "password123", clientId: fx.brandA })
      );
      expect(res.status).toBe(403);
    });
    it("org_admin → creates a brand (201)", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await clientsPost(jsonReq({ name: "Brand C", slug: "brand-c" }));
      expect(res.status).toBe(201);
    });
    it("owner → creates a member with a default-viewer membership (201)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await usersPost(
        jsonReq({ firstName: "New", lastName: "Member", email: "newmember@org-a.test", password: "password123", clientId: fx.brandA })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.org_id).toBe(fx.orgA);
      expect(data.brand_role).toBe("viewer");
      const m = await db.query.memberships.findFirst({
        where: and(eq(memberships.user_id, data.id), eq(memberships.client_id, fx.brandA)),
      });
      expect(m?.brand_role).toBe("viewer");
    });
  });

  // 3b. User deactivation guards.
  describe("user deactivation guards", () => {
    it("cross-org DELETE → 404", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await userDelete(jsonReq(undefined, "DELETE"), ctxParam(fx.ownerB));
      expect(res.status).toBe(404);
    });
    it("self-deactivation → 409", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await userDelete(jsonReq(undefined, "DELETE"), ctxParam(fx.owner));
      expect(res.status).toBe(409);
    });
  });

  // 4. Password takeover closed.
  describe("password reset access", () => {
    it("operator target → 404", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await passwordPost(
        jsonReq({ password: "password123", confirmPassword: "password123" }),
        ctxParam(fx.operator)
      );
      expect(res.status).toBe(404);
    });
    it("same-org peer by a recruiter → 403", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await passwordPost(
        jsonReq({ password: "password123", confirmPassword: "password123" }),
        ctxParam(fx.viewer)
      );
      expect(res.status).toBe(403);
    });
    it("self → 200", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await passwordPost(
        jsonReq({ password: "password123", confirmPassword: "password123" }),
        ctxParam(fx.recruiter)
      );
      expect(res.status).toBe(200);
    });
  });

  // 5. POPIA org-scope (lib-level): a tenant purge/lookup never reaches the
  //    other org's shared-email rows.
  describe("POPIA org-scope", () => {
    it("access-request returns only the actor org's records", async () => {
      const a = await handleDataAccessRequest("shared@popia.test", fx.orgA);
      expect(a?.records).toHaveLength(1);
      expect(a?.records[0].candidate_id).toBe(fx.popiaA);
      const b = await handleDataAccessRequest("shared@popia.test", fx.orgB);
      expect(b?.records).toHaveLength(1);
      expect(b?.records[0].candidate_id).toBe(fx.popiaB);
    });
    it("deletion-request purges only the actor org; the other org is untouched", async () => {
      const result = await handleDataDeletionRequest("shared@popia.test", fx.orgA);
      expect(result.purged).toBe(1);
      const a = await db.query.candidates.findFirst({ where: eq(candidates.id, fx.popiaA) });
      const b = await db.query.candidates.findFirst({ where: eq(candidates.id, fx.popiaB) });
      expect(a?.purged_at).not.toBeNull();
      expect(b?.purged_at).toBeNull();
    });
    it("run-purge scopes expiry to the actor org", async () => {
      const result = await findAndPurgeExpiredCandidates(fx.orgB);
      expect(result.purged).toBe(1);
      const b = await db.query.candidates.findFirst({ where: eq(candidates.id, fx.popiaB) });
      expect(b?.purged_at).not.toBeNull();
    });
    it("a non-acting operator (orgId null) purges nothing", async () => {
      const result = await findAndPurgeExpiredCandidates(null);
      expect(result.purged).toBe(0);
    });
  });

  // 6. Public writes stamp org_id from the resolved campaign (matches the trigger).
  describe("public writes stamp org_id", () => {
    it("apply insert carries the campaign's org_id", async () => {
      const res = await applyPost(
        jsonReq({ name: "Applicant", email: "applicant@public.test", popia_consent: true, answers: {} }),
        { params: Promise.resolve({ clientSlug: "brand-a", campaignSlug: "campaign-a" }) }
      );
      expect(res.status).toBe(201);
      const row = await db.query.candidates.findFirst({
        where: and(eq(candidates.email, "applicant@public.test"), eq(candidates.campaign_id, fx.campaignA)),
      });
      expect(row?.org_id).toBe(fx.orgA);
    });
    it("events insert carries the campaign's org_id", async () => {
      const res = await eventsPost(
        jsonReq({ client_slug: "brand-a", campaign_slug: "campaign-a", session_id: "s1", events: [{ type: "page_view" }] })
      );
      expect(res.status).toBe(202);
      const ev = await db.query.events.findFirst({ where: eq(events.campaign_id, fx.campaignA) });
      expect(ev?.org_id).toBe(fx.orgA);
    });
  });

  // 7. A non-acting operator (effectiveOrgId null) writes nothing.
  describe("non-acting operator", () => {
    it("campaign PATCH → 404 (orgScope FALSE)", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await campaignPatch(jsonReq({ role_title: "x" }, "PATCH"), ctxParam(fx.campaignA));
      expect(res.status).toBe(404);
    });
    it("client POST → 403 (no org role)", async () => {
      login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });
      const res = await clientsPost(jsonReq({ name: "Op", slug: "op-brand" }));
      expect(res.status).toBe(403);
    });
  });
});
