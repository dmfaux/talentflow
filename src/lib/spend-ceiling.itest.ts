import { beforeAll, describe, expect, it, vi } from "vitest";

// The recovery route claims + runs jobs; stub the worker so the no-op claim loop
// never reaches real scoring (we only assert which jobs the recovery INSERT made).
vi.mock("@/lib/queue/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queue/worker")>();
  return { ...actual, handleJob: async () => {} };
});

// getQueue() resolves DbQueue via a dynamic require() vitest can't load (see
// usage-metering.itest). Stub it with an enqueue that inserts a real job row so
// resumeOrgIntake's effect is observable in the jobs table.
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({
    enqueue: async (
      payload: { type: string },
      options?: { orgId?: string; deduplicationId?: string }
    ) => {
      const { db } = await import("@/db");
      const { jobs } = await import("@/db/schema");
      await db
        .insert(jobs)
        .values({
          type: payload.type,
          payload,
          org_id: options?.orgId ?? null,
          deduplication_id:
            options?.orgId && options?.deduplicationId
              ? `${options.orgId}:${options.deduplicationId}`
              : options?.deduplicationId ?? null,
        })
        .onConflictDoNothing();
    },
  }),
}));

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  jobs,
  organizations,
  plans,
  usageEvents,
} from "@/db/schema";
import { getCeilingStatus, resumeOrgIntake } from "@/lib/spend-ceiling";
import { POST as processJobs } from "@/app/api/jobs/process/route";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const RUN = !!process.env.DATABASE_URL;

const fx = {
  orgOver: "", // ceiling 10, usage ≥ 10 → over
  orgUncapped: "", // no ceiling
  orgUnder: "", // ceiling 1000, usage 0 → under
  candOver: "",
  candUncapped: "",
  candUnder: "",
  candNoCv: "", // held but no CV → resume must skip
};

const RUBRIC = {
  must_haves: [],
  nice_to_haves: [],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
};

async function makeOrg(slug: string, ceiling: number | null): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ slug, name: slug, hard_ceiling_credits: ceiling })
    .returning({ id: organizations.id });
  const [brand] = await db
    .insert(clients)
    .values({ org_id: org.id, slug: `${slug}-b`, name: `${slug} brand` })
    .returning({ id: clients.id });
  await db.insert(campaigns).values({
    org_id: org.id,
    client_id: brand.id,
    slug: `${slug}-c`,
    role_title: "Engineer",
    gating_config: [],
    scoring_rubric: RUBRIC,
  });
  return org.id;
}

async function makeHeldCandidate(orgId: string, cvUrl: string | null): Promise<string> {
  const [camp] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.org_id, orgId))
    .limit(1);
  const [c] = await db
    .insert(candidates)
    .values({
      org_id: orgId,
      campaign_id: camp.id,
      name: "Held",
      email: `held-${orgId.slice(0, 6)}-${cvUrl ?? "nocv"}@x.com`,
      status: "gating_passed",
      gating_passed: true,
      cv_url: cvUrl,
    })
    .returning({ id: candidates.id });
  return c.id;
}

/** Jobs whose payload targets a candidate, any status (completed rows persist). */
async function jobCountFor(candidateId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "candidate-processing"),
        eq(sql`${jobs.payload}->>'candidateId'`, candidateId)
      )
    );
  return row?.n ?? 0;
}

describe.skipIf(!RUN)("spend-ceiling enforcement (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(jobs);
    await db.delete(organizations); // cascades clients/campaigns/candidates/usage_events
    await db.delete(plans);
    await db.insert(plans).values({
      tier: "standard",
      base_fee_zar: 7500,
      included_credits: 6000,
      overage_discount_pct: 0,
    });

    fx.orgOver = await makeOrg("ceil-over", 10);
    fx.orgUncapped = await makeOrg("ceil-uncapped", null);
    fx.orgUnder = await makeOrg("ceil-under", 1000);

    // orgOver: 11 base units professional = 11 credits ≥ 10 → over.
    await db.insert(usageEvents).values({
      org_id: fx.orgOver,
      kind: "ai_tokens",
      model: "claude-sonnet-4-6",
      model_tier: "professional",
      input_tokens: 11000,
      output_tokens: 0,
    });

    fx.candOver = await makeHeldCandidate(fx.orgOver, "cv/over.pdf");
    fx.candUncapped = await makeHeldCandidate(fx.orgUncapped, "cv/uncapped.pdf");
    fx.candUnder = await makeHeldCandidate(fx.orgUnder, "cv/under.pdf");
    fx.candNoCv = await makeHeldCandidate(fx.orgUncapped, null);
  });

  it("getCeilingStatus: over when period credits reach the ceiling", async () => {
    const s = await getCeilingStatus(fx.orgOver);
    expect(s.effectiveCeiling).toBe(10);
    expect(s.periodCredits).toBeGreaterThanOrEqual(10);
    expect(s.over).toBe(true);
  });

  it("getCeilingStatus: uncapped org is never over (and skips the credit sum)", async () => {
    const s = await getCeilingStatus(fx.orgUncapped);
    expect(s.effectiveCeiling).toBeNull();
    expect(s.over).toBe(false);
    expect(s.periodCredits).toBe(0);
  });

  it("getCeilingStatus: a configured ceiling with low usage is under", async () => {
    const s = await getCeilingStatus(fx.orgUnder);
    expect(s.effectiveCeiling).toBe(1000);
    expect(s.over).toBe(false);
  });

  it("resumeOrgIntake enqueues held candidates with a CV, skips those without", async () => {
    await db.delete(jobs);
    const n = await resumeOrgIntake(fx.orgUncapped);
    expect(n).toBe(1); // candUncapped has a CV; candNoCv does not
    expect(await jobCountFor(fx.candUncapped)).toBe(1);
    expect(await jobCountFor(fx.candNoCv)).toBe(0);
  });

  it("recovery backstop skips over-ceiling orgs but recovers uncapped/under orgs", async () => {
    await db.delete(jobs); // clear so the recovery 'no live job' guard is clean
    const res = await processJobs(
      new NextRequest("http://localhost/api/jobs/process", { method: "POST" })
    );
    expect(res.status).toBe(200);

    // Over-ceiling org's held candidate is NOT recovered (intake stays paused).
    expect(await jobCountFor(fx.candOver)).toBe(0);
    // Uncapped + under-ceiling orgs' held candidates ARE recovered (drain).
    expect(await jobCountFor(fx.candUncapped)).toBe(1);
    expect(await jobCountFor(fx.candUnder)).toBe(1);
  });
});
