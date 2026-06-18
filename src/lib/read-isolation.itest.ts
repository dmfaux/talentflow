import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Session seam mock ────────────────────────────────────────────────
// Mirrors isolation.itest.ts: getApiTenant/requireTenant resolve through
// getSession(), which reads a cookie. In a DB test there is no request scope,
// so we mock getSession to return a chosen tenant; tenantFromSession, orgScope,
// resolveOwnedResource and every route body run for real against the DB.
const sessionHolder = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => sessionHolder.current,
    getActAsClaim: async () => null,
    getActiveBrandCookie: async () => null,
  };
});

// candidates/[id]/route imports the queue (dynamic require) + email opens a
// socket — irrelevant to reads. Stub them so the module imports cleanly.
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendCandidateEmail: async () => null, sendTransactionalEmail: async () => null };
});

// The headline S4/S6 acceptance: a cross-org CV must 404 with NO SAS minted.
// Spy on generateSasUrl so we can assert it is never reached for another org.
const sas = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/azure-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azure-storage")>();
  return {
    ...actual,
    generateSasUrl: () => {
      sas.calls++;
      return "https://sas.example/blob";
    },
  };
});

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  events,
  memberships,
  operatorAudit,
  organizations,
  users,
} from "@/db/schema";
import { NextRequest } from "next/server";

import { GET as dashboardGet } from "@/app/api/admin/dashboard/route";
import { GET as analyticsGet } from "@/app/api/admin/analytics/route";
import { GET as campaignGet } from "@/app/api/admin/campaigns/[id]/route";
import { GET as campaignCandidatesGet } from "@/app/api/admin/campaigns/[id]/candidates/route";
import { GET as campaignAnalyticsGet } from "@/app/api/admin/campaigns/[id]/analytics/route";
import { GET as campaignReportGet } from "@/app/api/admin/campaigns/[id]/report/route";
import { GET as candidateGet } from "@/app/api/admin/candidates/[id]/route";
import { GET as chatTranscriptGet } from "@/app/api/admin/candidates/[id]/chat-transcript/route";
import { GET as cvGet } from "@/app/api/admin/candidates/[id]/cv/route";

const RUN = !!process.env.DATABASE_URL;

const ctxParam = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs = "") => new NextRequest(`http://localhost/api/test${qs}`);

type Session = {
  userId: string;
  orgId: string | null;
  orgRole: "owner" | "org_admin" | null;
  isOperator: boolean;
};
function login(s: Session) {
  sessionHolder.current = s;
}

const fx = {
  orgA: "",
  orgB: "",
  brandA: "",
  brandB: "",
  campaignA: "",
  campaignB: "",
  candA1: "",
  candB1: "",
  ownerA: "",
  ownerB: "",
  operator: "",
};

async function seedCampaign(orgId: string, clientId: string, slug: string) {
  const [c] = await db
    .insert(campaigns)
    .values({
      org_id: orgId,
      client_id: clientId,
      slug,
      role_title: `Role ${slug}`,
      status: "active",
      campaign_start: new Date(),
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

async function seedPageViews(orgId: string, campaignId: string, n: number, tag: string) {
  await db.insert(events).values(
    Array.from({ length: n }, (_, i) => ({
      org_id: orgId,
      campaign_id: campaignId,
      event_type: "page_view",
      session_id: `${tag}-sess-${i}`,
      visitor_id: `${tag}-vis-${i}`,
      browser: "Chrome",
      device_type: "desktop",
    }))
  );
}

describe.skipIf(!RUN)("S4 read-isolation (DB-backed)", () => {
  beforeAll(async () => {
    // Clean slate in dependency order (operator_audit before users — FK SET NULL
    // on a NOT NULL column trips otherwise).
    await db.delete(operatorAudit);
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

    fx.ownerA = (
      await db
        .insert(users)
        .values({ org_id: fx.orgA, org_role: "owner", is_operator: false, first_name: "A", last_name: "Owner", email: "owner@a.test", password_hash: "x" })
        .returning({ id: users.id })
    )[0].id;
    fx.ownerB = (
      await db
        .insert(users)
        .values({ org_id: fx.orgB, org_role: "owner", is_operator: false, first_name: "B", last_name: "Owner", email: "owner@b.test", password_hash: "x" })
        .returning({ id: users.id })
    )[0].id;
    fx.operator = (
      await db
        .insert(users)
        .values({ org_id: null, org_role: null, is_operator: true, first_name: "Op", last_name: "Erator", email: "op@ops.test", password_hash: "x" })
        .returning({ id: users.id })
    )[0].id;

    fx.campaignA = await seedCampaign(fx.orgA, fx.brandA, "campaign-a");
    fx.campaignB = await seedCampaign(fx.orgB, fx.brandB, "campaign-b");

    // Org A: 3 candidates (1 shortlisted, scored). Org B: 2 candidates.
    fx.candA1 = await seedCandidate(fx.orgA, fx.campaignA, "a1@x.test", {
      ai_score: 8.2, status: "shortlisted", gating_passed: true, cv_url: "cvs/org-a/a1.pdf",
    });
    await seedCandidate(fx.orgA, fx.campaignA, "a2@x.test", { ai_score: 6.1, status: "scored", gating_passed: true });
    await seedCandidate(fx.orgA, fx.campaignA, "a3@x.test", { status: "new" });
    fx.candB1 = await seedCandidate(fx.orgB, fx.campaignB, "b1@x.test", {
      ai_score: 7.7, status: "shortlisted", gating_passed: true, cv_url: "cvs/org-b/b1.pdf",
    });
    await seedCandidate(fx.orgB, fx.campaignB, "b2@x.test", { status: "new" });

    await seedPageViews(fx.orgA, fx.campaignA, 2, "a");
    await seedPageViews(fx.orgB, fx.campaignB, 3, "b");
  });

  afterAll(() => {
    sessionHolder.current = null;
  });

  beforeEach(() => {
    sas.calls = 0;
  });

  const ownerA = () => login({ userId: fx.ownerA, orgId: fx.orgA, orgRole: "owner", isOperator: false });
  const ownerB = () => login({ userId: fx.ownerB, orgId: fx.orgB, orgRole: "owner", isOperator: false });
  const nonActingOperator = () => login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });

  async function body(res: Response) {
    return res.json() as Promise<Record<string, unknown>>;
  }

  // ── 1. Cross-org id → 404 (indistinguishable from missing) ─────────
  describe("cross-org reads → 404", () => {
    beforeEach(ownerA);

    it("campaign GET on another org's campaign", async () => {
      expect((await campaignGet(req(), ctxParam(fx.campaignB))).status).toBe(404);
    });
    it("candidate GET on another org's candidate", async () => {
      expect((await candidateGet(req(), ctxParam(fx.candB1))).status).toBe(404);
    });
    it("campaign candidates (applicants) list on another org's campaign", async () => {
      expect((await campaignCandidatesGet(req(), ctxParam(fx.campaignB))).status).toBe(404);
    });
    it("campaign analytics on another org's campaign", async () => {
      expect((await campaignAnalyticsGet(req(), ctxParam(fx.campaignB))).status).toBe(404);
    });
    it("campaign report on another org's campaign", async () => {
      expect((await campaignReportGet(req(), ctxParam(fx.campaignB))).status).toBe(404);
    });
    it("chat transcript on another org's candidate", async () => {
      expect((await chatTranscriptGet(req(), ctxParam(fx.candB1))).status).toBe(404);
    });
    it("top-level analytics?campaign_id=<other org> → 404", async () => {
      expect((await analyticsGet(req(`?campaign_id=${fx.campaignB}`))).status).toBe(404);
    });

    it("CV on another org's candidate → 404 with NO SAS minted", async () => {
      const res = await cvGet(req(), ctxParam(fx.candB1));
      expect(res.status).toBe(404);
      expect(sas.calls).toBe(0); // never reached generateSasUrl
    });
  });

  // ── 2. In-org reads succeed (positive control) ─────────────────────
  describe("in-org reads → 200", () => {
    beforeEach(ownerA);

    it("own campaign GET → 200", async () => {
      expect((await campaignGet(req(), ctxParam(fx.campaignA))).status).toBe(200);
    });
    it("own candidate GET → 200", async () => {
      expect((await candidateGet(req(), ctxParam(fx.candA1))).status).toBe(200);
    });
    it("own applicants list → 200 with exactly the org's candidates", async () => {
      const res = await campaignCandidatesGet(req(), ctxParam(fx.campaignA));
      expect(res.status).toBe(200);
      const data = (await body(res)).data as { total: number };
      expect(data.total).toBe(3);
    });
    it("own CV → 200 and SAS minted", async () => {
      const res = await cvGet(req(), ctxParam(fx.candA1));
      expect(res.status).toBe(200);
      expect(sas.calls).toBe(1);
    });
  });

  // ── 3. Dashboard totals reflect ONLY the caller's org ──────────────
  describe("dashboard is org-scoped", () => {
    it("Org A sees only Org A campaigns + candidates", async () => {
      ownerA();
      const data = (await body(await dashboardGet(req("?range=all")))).data as {
        campaigns: { total: number };
        candidates: { total: number };
        recent_campaigns: { id: string; role_title: string }[];
      };
      expect(data.campaigns.total).toBe(1);
      expect(data.candidates.total).toBe(3);
      expect(data.recent_campaigns.map((c) => c.id)).toEqual([fx.campaignA]);
    });

    it("Org B sees only Org B campaigns + candidates", async () => {
      ownerB();
      const data = (await body(await dashboardGet(req("?range=all")))).data as {
        campaigns: { total: number };
        candidates: { total: number };
        recent_campaigns: { id: string }[];
      };
      expect(data.campaigns.total).toBe(1);
      expect(data.candidates.total).toBe(2);
      expect(data.recent_campaigns.map((c) => c.id)).toEqual([fx.campaignB]);
    });
  });

  // ── 4. Visitor analytics is org-scoped ─────────────────────────────
  describe("analytics is org-scoped", () => {
    it("Org A counts only Org A page views", async () => {
      ownerA();
      const data = (await body(await analyticsGet(req("?range=all")))).data as {
        visitors: { total: number };
      };
      expect(data.visitors.total).toBe(2);
    });
    it("Org B counts only Org B page views", async () => {
      ownerB();
      const data = (await body(await analyticsGet(req("?range=all")))).data as {
        visitors: { total: number };
      };
      expect(data.visitors.total).toBe(3);
    });
  });

  // ── 5. A non-acting operator loads NO tenant data ──────────────────
  describe("non-acting operator sees nothing", () => {
    beforeEach(nonActingOperator);

    it("dashboard is all-zero", async () => {
      const data = (await body(await dashboardGet(req("?range=all")))).data as {
        campaigns: { total: number };
        candidates: { total: number };
        recent_campaigns: unknown[];
      };
      expect(data.campaigns.total).toBe(0);
      expect(data.candidates.total).toBe(0);
      expect(data.recent_campaigns).toEqual([]);
    });
    it("a real campaign id → 404 (orgScope FALSE)", async () => {
      expect((await campaignGet(req(), ctxParam(fx.campaignA))).status).toBe(404);
    });
  });
});
