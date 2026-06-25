import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
// Scoring goes through callWithFallback — stub it to a BELOW-min score (no
// flags) so scoreCandidate takes the recommend-for-rejection path.
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    callWithFallback: async () => ({
      output: {
        overall_score: 3,
        dimensions: {
          skills_match: 3,
          experience_depth: 3,
          career_progression: 3,
          tenure_patterns: 3,
        },
        confidence: "high",
        rationale: "Weak match.",
        flags: [],
        recommendation: "reject",
      },
      text: "raw model text",
      providerName: "anthropic",
      modelId: "claude-test",
      usage: { inputTokens: 100, outputTokens: 50 },
      attempts: [],
    }),
  };
});

// Capture every enqueue so we can assert what email (if any) is queued.
const enqueued = vi.hoisted(() => ({ jobs: [] as { payload: unknown; opts: unknown }[] }));
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({
    enqueue: async (payload: unknown, opts: unknown) => {
      enqueued.jobs.push({ payload, opts });
    },
  }),
}));

import { db } from "@/db";
import {
  campaigns,
  candidateActionAudit,
  candidates,
  clients,
  organizations,
  users,
} from "@/db/schema";
import { scoreCandidate } from "@/lib/ai-scoring";
import { acceptRejection, dismissRejection } from "@/lib/rejection";
import { desc, eq } from "drizzle-orm";

const RUN = !!process.env.DATABASE_URL;

const fx = { orgA: "", brandA: "", campA: "", userA: "" };

const FULL_RUBRIC = {
  must_haves: ["TypeScript"],
  nice_to_haves: [],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
  min_score: 5,
};

async function insertCandidate(overrides: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(candidates)
    .values({
      org_id: fx.orgA,
      campaign_id: fx.campA,
      name: "Cand",
      email: "c@example.com",
      cv_text: "Some CV text.",
      status: "scoring",
      ...overrides,
    })
    .returning({ id: candidates.id });
  return row.id;
}

function auditFor(candidateId: string) {
  return db
    .select()
    .from(candidateActionAudit)
    .where(eq(candidateActionAudit.candidate_id, candidateId))
    .orderBy(desc(candidateActionAudit.created_at));
}

const candidateRow = (id: string) =>
  db.query.candidates.findFirst({ where: eq(candidates.id, id) });

describe.skipIf(!RUN)("human-in-the-loop rejection (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(organizations); // cascades to clients/campaigns/candidates/audit

    [fx.orgA] = (
      await db
        .insert(organizations)
        .values({ slug: "rej-org-a", name: "Rej Org A" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "rej-brand-a", name: "Brand A" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.campA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "rej-c",
          role_title: "Engineer",
          gating_config: [],
          scoring_rubric: FULL_RUBRIC,
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.userA] = (
      await db
        .insert(users)
        .values({
          org_id: fx.orgA,
          org_role: "owner",
          first_name: "Reka",
          last_name: "Naidoo",
          email: "reka@example.com",
          password_hash: "x",
        })
        .returning({ id: users.id })
    ).map((u) => u.id);
  });

  beforeEach(() => {
    enqueued.jobs = [];
  });

  it("scoreCandidate parks a below-min candidate in pending_rejection — no auto-reject, no email", async () => {
    const id = await insertCandidate({ status: "scoring" });
    await scoreCandidate(id);

    const c = await candidateRow(id);
    expect(c?.status).toBe("pending_rejection");
    expect(c?.rejection_recommended_at).not.toBeNull();

    // No rejection email was queued — a human must accept first.
    const emails = enqueued.jobs.filter(
      (j) => (j.payload as { type?: string }).type === "send-email"
    );
    expect(emails).toHaveLength(0);

    // A system (actor-less) recommendation row was recorded.
    const audit = await auditFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("reject_recommended");
    expect(audit[0].actor_user_id).toBeNull();
    expect(audit[0].to_status).toBe("pending_rejection");
  });

  it("acceptRejection rejects, audits the actor + reason, and emails the candidate when opted in", async () => {
    const id = await insertCandidate({
      status: "pending_rejection",
      rejection_reason: "Recommended for rejection: score 3.0 is below 5.",
      rejection_recommended_at: new Date(),
      ai_score: 3,
    });

    const res = await acceptRejection({
      candidate: {
        id,
        org_id: fx.orgA,
        status: "pending_rejection",
        rejection_reason: "Recommended for rejection: score 3.0 is below 5.",
        ai_score: 3,
        ai_rationale: "Weak match.",
      },
      actorUserId: fx.userA,
      reason: "Thanks for applying — we went with stronger Go experience.",
      notifyCandidate: true,
    });

    expect(res.ok).toBe(true);

    const c = await candidateRow(id);
    expect(c?.status).toBe("rejected");
    expect(c?.rejection_reason).toBe(
      "Thanks for applying — we went with stronger Go experience."
    );

    const audit = await auditFor(id);
    expect(audit[0].action).toBe("reject_accepted");
    expect(audit[0].actor_user_id).toBe(fx.userA);
    expect(audit[0].reason_sent_to_candidate).toBe(true);

    // The rejection email carries the candidate-facing note.
    const email = enqueued.jobs.find(
      (j) => (j.payload as { emailKind?: string }).emailKind === "rejected"
    );
    expect(email).toBeTruthy();
    expect((email!.payload as { adminReason?: string }).adminReason).toBe(
      "Thanks for applying — we went with stronger Go experience."
    );
  });

  it("acceptRejection without opt-in does not attach the note to the email", async () => {
    const id = await insertCandidate({
      status: "pending_rejection",
      rejection_recommended_at: new Date(),
    });
    await acceptRejection({
      candidate: { id, org_id: fx.orgA, status: "pending_rejection", rejection_reason: null, ai_score: 3, ai_rationale: null },
      actorUserId: fx.userA,
      reason: "internal only",
      notifyCandidate: false,
    });

    const email = enqueued.jobs.find(
      (j) => (j.payload as { emailKind?: string }).emailKind === "rejected"
    );
    expect((email!.payload as { adminReason?: string }).adminReason).toBeUndefined();

    const audit = await auditFor(id);
    expect(audit[0].reason).toBe("internal only");
    expect(audit[0].reason_sent_to_candidate).toBe(false);
  });

  it("dismissRejection returns the candidate to scored, clears the reason, and audits", async () => {
    const id = await insertCandidate({
      status: "pending_rejection",
      rejection_reason: "Recommended for rejection…",
      rejection_recommended_at: new Date(),
    });

    const res = await dismissRejection({
      candidate: { id, org_id: fx.orgA, status: "pending_rejection", rejection_reason: "Recommended for rejection…", ai_score: 3, ai_rationale: null },
      actorUserId: fx.userA,
    });

    expect(res.ok).toBe(true);
    const c = await candidateRow(id);
    expect(c?.status).toBe("scored");
    expect(c?.rejection_reason).toBeNull();

    const audit = await auditFor(id);
    expect(audit[0].action).toBe("reject_dismissed");
    expect(audit[0].to_status).toBe("scored");

    // No email on dismiss.
    expect(enqueued.jobs).toHaveLength(0);
  });

  it("accept is a no-op when the candidate is no longer pending_rejection (race guard)", async () => {
    const id = await insertCandidate({ status: "scored" });
    const res = await acceptRejection({
      candidate: { id, org_id: fx.orgA, status: "scored", rejection_reason: null, ai_score: 6, ai_rationale: null },
      actorUserId: fx.userA,
    });
    expect(res).toEqual({ ok: false, code: "not_pending" });

    const c = await candidateRow(id);
    expect(c?.status).toBe("scored");
    expect(enqueued.jobs).toHaveLength(0);
  });
});
