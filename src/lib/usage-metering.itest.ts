import { beforeAll, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
// Operator GET needs a session; there is no request context in a DB test.
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

// Scoring goes through callWithFallback — stub it to a known result + usage so
// we can assert the exact token counts that land in usage_events.
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    callWithFallback: async () => ({
      output: {
        overall_score: 7,
        dimensions: {
          skills_match: 7,
          experience_depth: 7,
          career_progression: 7,
          tenure_patterns: 7,
        },
        confidence: "high",
        rationale: "Solid match.",
        flags: [],
        recommendation: "recommend",
      },
      text: "raw model text",
      providerName: "anthropic",
      modelId: "claude-test",
      usage: { inputTokens: 321, outputTokens: 123 },
      attempts: [],
    }),
  };
});

// The queue uses a dynamic require() vitest can't resolve; stub it (scoring's
// "scored" path doesn't enqueue, but this avoids the loader issue regardless).
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));

// NOTE: email.ts resolves its transport via a dynamic require("nodemailer")
// that vitest's loader cannot intercept (same limitation that makes the other
// itests mock @/lib/email wholesale). So the per-brand From/Reply-To *identity*
// is asserted by the DB-free unit tests (brandEmailIdentity in usage.test.ts);
// here we exercise the real send (dev SMTP) and assert the centralised
// email_sent metering with org + brand attribution.

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  operatorAudit,
  organizations,
  usageEvents,
} from "@/db/schema";
import { scoreCandidate } from "@/lib/ai-scoring";
import { brandEmailIdentity, sendCandidateEmail } from "@/lib/email";
import { GET as operatorOrgGet } from "@/app/api/operator/organizations/[id]/route";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const RUN = !!process.env.DATABASE_URL;

const fx = { orgA: "", brandA: "", campA: "", candA: "" };

const FULL_RUBRIC = {
  must_haves: ["TypeScript"],
  nice_to_haves: ["GraphQL"],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
};

/** Poll the DB for a fire-and-forget recordUsageEvent insert to land. */
async function waitFor<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  tries = 40,
  delayMs = 50
): Promise<T> {
  let last = await fn();
  for (let i = 0; i < tries && !pred(last); i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    last = await fn();
  }
  return last;
}

describe.skipIf(!RUN)("S10 usage metering (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(operatorAudit);
    await db.delete(organizations); // cascades to clients/campaigns/candidates/usage_events

    [fx.orgA] = (
      await db
        .insert(organizations)
        .values({ slug: "meter-org-a", name: "Meter Org A" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "meter-brand-a", name: "Brand A" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.campA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "meter-c",
          role_title: "Engineer",
          gating_config: [],
          scoring_rubric: FULL_RUBRIC,
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.candA] = (
      await db
        .insert(candidates)
        .values({
          org_id: fx.orgA,
          campaign_id: fx.campA,
          name: "Cand A",
          email: "a@example.com",
          cv_text: "Ten years of TypeScript.",
          status: "scoring",
        })
        .returning({ id: candidates.id })
    ).map((c) => c.id);
  });

  it("scoreCandidate records an org-attributed ai_tokens row with SDK token counts", async () => {
    await scoreCandidate(fx.candA);

    const rows = await waitFor(
      () =>
        db
          .select()
          .from(usageEvents)
          .where(
            and(eq(usageEvents.org_id, fx.orgA), eq(usageEvents.kind, "ai_tokens"))
          ),
      (r) => r.length > 0
    );

    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe("claude-test");
    expect(row.input_tokens).toBe(321);
    expect(row.output_tokens).toBe(123);
    expect(row.brand_id).toBe(fx.brandA);
    expect(row.candidate_id).toBe(fx.candA);
  });

  it("meters email_sent with org + brand attribution on a candidate send", async () => {
    await sendCandidateEmail(
      "a@example.com",
      "Hello",
      "<p>hi</p>",
      fx.candA,
      brandEmailIdentity({ from_name: "Acme Talent", reply_to_email: "careers@acme.io" })
    );

    const rows = await waitFor(
      () =>
        db
          .select()
          .from(usageEvents)
          .where(
            and(eq(usageEvents.org_id, fx.orgA), eq(usageEvents.kind, "email_sent"))
          ),
      (r) => r.length > 0
    );
    expect(rows[0].brand_id).toBe(fx.brandA);
    expect(rows[0].candidate_id).toBe(fx.candA);
  });

  it("operator GET returns a per-org usage block (operator-gated)", async () => {
    sessionHolder.current = {
      userId: "op-1",
      orgId: null,
      orgRole: null,
      isOperator: true,
    };
    const res = await operatorOrgGet(
      new NextRequest("http://localhost/api/operator/organizations/x"),
      { params: Promise.resolve({ id: fx.orgA }) }
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.usage.period).toBe("30d");
    // scoreCandidate (deterministically mocked) recorded these for this org.
    expect(data.usage.byKind.ai_tokens.inputTokens).toBeGreaterThanOrEqual(321);
    expect(data.usage.byKind.ai_tokens.outputTokens).toBeGreaterThanOrEqual(123);
    expect(data.usage.tokens.input).toBeGreaterThanOrEqual(321);
    expect(data.usage.allTime.output).toBeGreaterThanOrEqual(123);
    // Fixed-key shape: an unused kind reports zeros, not undefined.
    expect(data.usage.byKind.candidate_created.count).toBe(0);
  });

  it("operator GET is forbidden for a non-operator", async () => {
    sessionHolder.current = {
      userId: "u-1",
      orgId: fx.orgA,
      orgRole: "owner",
      isOperator: false,
    };
    const res = await operatorOrgGet(
      new NextRequest("http://localhost/api/operator/organizations/x"),
      { params: Promise.resolve({ id: fx.orgA }) }
    );
    expect(res.status).toBe(403);
  });

  it("usage rows survive a candidate purge (candidate_id nulled) and die with the org", async () => {
    const [org] = await db
      .insert(organizations)
      .values({ slug: "meter-lc", name: "Lifecycle" })
      .returning({ id: organizations.id });
    const [brand] = await db
      .insert(clients)
      .values({ org_id: org.id, slug: "meter-lc-b", name: "LC Brand" })
      .returning({ id: clients.id });
    const [camp] = await db
      .insert(campaigns)
      .values({
        org_id: org.id,
        client_id: brand.id,
        slug: "lc",
        role_title: "R",
        gating_config: [],
        scoring_rubric: FULL_RUBRIC,
      })
      .returning({ id: campaigns.id });
    const [cand] = await db
      .insert(candidates)
      .values({ org_id: org.id, campaign_id: camp.id, name: "C", email: "lc@x.com" })
      .returning({ id: candidates.id });

    const [row] = await db
      .insert(usageEvents)
      .values({
        org_id: org.id,
        brand_id: brand.id,
        candidate_id: cand.id,
        kind: "ai_tokens",
        input_tokens: 5,
        output_tokens: 5,
      })
      .returning({ id: usageEvents.id });

    // Candidate purge (S11 surface): the cost ledger survives, candidate_id nulled.
    await db.delete(candidates).where(eq(candidates.id, cand.id));
    const afterCand = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.id, row.id));
    expect(afterCand).toHaveLength(1);
    expect(afterCand[0].candidate_id).toBeNull();
    expect(afterCand[0].org_id).toBe(org.id);

    // Org purge: ledger cascades away.
    await db.delete(organizations).where(eq(organizations.id, org.id));
    const afterOrg = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.id, row.id));
    expect(afterOrg).toHaveLength(0);
  });
});
