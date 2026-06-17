import { beforeAll, describe, expect, it, vi } from "vitest";

// The backstop test drives the real POST /api/jobs/process, which (after the
// recovery INSERT) claims the new job and dispatches it. We only assert that
// the backstop stamps org_id + namespaces its dedup key, so stub handleJob to a
// no-op rather than run real candidate processing.
vi.mock("@/lib/queue/worker", () => ({ handleJob: async () => {} }));

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  jobs,
  operatorAudit,
  organizations,
} from "@/db/schema";
import { DbQueue } from "@/lib/queue/db-queue";
import { POST as processJobs } from "@/app/api/jobs/process/route";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const RUN = !!process.env.DATABASE_URL;

const fx = {
  orgA: "",
  orgB: "",
  brandA: "",
  brandB: "",
  campA: "",
  campB: "",
  candA: "",
  candB: "",
};

const workerReq = () =>
  new NextRequest("http://localhost/api/jobs/process", { method: "POST" });

async function recoveryRowsFor(candidateId: string) {
  return db
    .select()
    .from(jobs)
    .where(sql`${jobs.payload}->>'candidateId' = ${candidateId}`);
}

describe.skipIf(!RUN)("S10 tenant-safe queue dedup + org attribution (DB-backed)", () => {
  beforeAll(async () => {
    // operator_audit set-nulls a NOT NULL user FK, so clear it before the
    // cascade from organizations would delete its users. organizations cascade
    // handles everything else (clients/campaigns/candidates/jobs/usage_events).
    await db.delete(operatorAudit);
    await db.delete(organizations);

    [fx.orgA, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: "dedup-org-a", name: "Dedup Org A" },
          { slug: "dedup-org-b", name: "Dedup Org B" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "dedup-brand-a", name: "Brand A" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.brandB] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgB, slug: "dedup-brand-b", name: "Brand B" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    [fx.campA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "c-a",
          role_title: "Role A",
          gating_config: [],
          scoring_rubric: {},
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.campB] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgB,
          client_id: fx.brandB,
          slug: "c-b",
          role_title: "Role B",
          gating_config: [],
          scoring_rubric: {},
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);

    // gating_passed + cv_url so the recovery backstop picks them up immediately.
    [fx.candA] = (
      await db
        .insert(candidates)
        .values({
          org_id: fx.orgA,
          campaign_id: fx.campA,
          name: "Cand A",
          email: "a@example.com",
          status: "gating_passed",
          gating_passed: true,
          cv_url: "cvs/a",
        })
        .returning({ id: candidates.id })
    ).map((c) => c.id);
    [fx.candB] = (
      await db
        .insert(candidates)
        .values({
          org_id: fx.orgB,
          campaign_id: fx.campB,
          name: "Cand B",
          email: "b@example.com",
          status: "gating_passed",
          gating_passed: true,
          cv_url: "cvs/b",
        })
        .returning({ id: candidates.id })
    ).map((c) => c.id);
  });

  it("two orgs' identical raw dedup keys do NOT collide (headline acceptance)", async () => {
    await db.delete(jobs);
    const q = new DbQueue();

    await q.enqueue(
      { type: "candidate-processing", candidateId: fx.candA },
      { orgId: fx.orgA, deduplicationId: "process-shared" }
    );
    await q.enqueue(
      { type: "candidate-processing", candidateId: fx.candB },
      { orgId: fx.orgB, deduplicationId: "process-shared" }
    );

    const rows = await db.select().from(jobs);
    expect(rows).toHaveLength(2);

    const a = rows.find((r) => r.org_id === fx.orgA);
    const b = rows.find((r) => r.org_id === fx.orgB);
    expect(a?.deduplication_id).toBe(`${fx.orgA}:process-shared`);
    expect(b?.deduplication_id).toBe(`${fx.orgB}:process-shared`);
  });

  it("same-org duplicate dedup key still suppresses the true duplicate", async () => {
    await db.delete(jobs);
    const q = new DbQueue();

    await q.enqueue(
      { type: "candidate-processing", candidateId: fx.candA },
      { orgId: fx.orgA, deduplicationId: "process-dup" }
    );
    await q.enqueue(
      { type: "candidate-processing", candidateId: fx.candA },
      { orgId: fx.orgA, deduplicationId: "process-dup" }
    );

    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.deduplication_id, `${fx.orgA}:process-dup`));
    expect(rows).toHaveLength(1);
  });

  it("the raw-SQL backstop stamps org_id from candidates.org_id + namespaces its key", async () => {
    await db.delete(jobs);

    const res = await processJobs(workerReq());
    expect(res.status).toBe(200);

    const aRows = await recoveryRowsFor(fx.candA);
    expect(aRows).toHaveLength(1);
    expect(aRows[0].org_id).toBe(fx.orgA); // non-null, from candidates.org_id
    expect(aRows[0].deduplication_id).toBe(`${fx.orgA}:process-recovery-${fx.candA}`);

    // Each candidate-derived recovery row carries its own org (no cross-bleed).
    const bRows = await recoveryRowsFor(fx.candB);
    expect(bRows[0].org_id).toBe(fx.orgB);
  });

  it("the backstop throttle still fires under the namespaced key", async () => {
    await db.delete(jobs);

    await processJobs(workerReq());
    await processJobs(workerReq()); // within the 15-min window

    // Throttle matches the namespaced recovery key, so the second tick adds no
    // duplicate recovery row for the same candidate.
    const aRows = await recoveryRowsFor(fx.candA);
    expect(aRows).toHaveLength(1);
  });
});
