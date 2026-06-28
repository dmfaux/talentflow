import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
// Capture every enqueue so we can assert whether scoring was queued.
const enqueued = vi.hoisted(() => ({
  jobs: [] as { payload: unknown; opts: unknown }[],
}));
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({
    enqueue: async (payload: unknown, opts: unknown) => {
      enqueued.jobs.push({ payload, opts });
    },
  }),
}));

// Spend ceiling is flipped per-test to exercise the "over cap → hold" branch.
const ceiling = vi.hoisted(() => ({ over: false }));
vi.mock("@/lib/spend-ceiling", () => ({
  getCeilingStatus: async () => ({ over: ceiling.over }),
}));

import { db } from "@/db";
import {
  campaigns,
  candidateActionAudit,
  candidates,
  chatTokens,
  clients,
  organizations,
  users,
} from "@/db/schema";
import { verifyMagicLinkToken } from "@/lib/chat-auth";
import { CONSENT_ATTESTATIONS, CURRENT_ATTESTATION } from "@/lib/consent";
import {
  addCandidateByInvite,
  addCandidateBySkip,
  decideGating,
  findCampaignCandidateByEmail,
  INVITED_STATUS,
  recordConsentConfirmed,
  recordOptOut,
  RECRUITER_MANUAL_SOURCE,
} from "@/lib/manual-candidate";
import { INVITE_TOKEN_TTL_MS } from "@/lib/chat-auth";
import { desc, eq } from "drizzle-orm";

const RUN = !!process.env.DATABASE_URL;

const fx = { orgA: "", brandA: "", campA: "", userA: "" };

// One select gating question: answer "yes" passes, "no" fails.
const GATING_CONFIG = [
  {
    id: "eligible",
    label: "Eligible to work?",
    type: "select",
    options: [{ value: "yes" }, { value: "no" }],
    pass_criteria: ["yes"],
  },
];

const FULL_RUBRIC = {
  must_haves: ["TypeScript"],
  nice_to_haves: [],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
  min_score: 5,
};

const CONSENT = {
  version: CURRENT_ATTESTATION,
  basis: "verbal" as const,
  note: null,
};

function auditFor(candidateId: string) {
  return db
    .select()
    .from(candidateActionAudit)
    .where(eq(candidateActionAudit.candidate_id, candidateId))
    .orderBy(desc(candidateActionAudit.created_at));
}

const candidateRow = (id: string) =>
  db.query.candidates.findFirst({ where: eq(candidates.id, id) });

const processingJobs = () =>
  enqueued.jobs.filter(
    (j) => (j.payload as { type?: string }).type === "candidate-processing"
  );

// ── Pure logic (runs without a DB) ───────────────────────────────────

describe("decideGating", () => {
  it("null answers ⇒ recruiter_override, always passes", () => {
    expect(decideGating(null, GATING_CONFIG)).toEqual({
      gatingPassed: true,
      gatingSource: "recruiter_override",
      gatingAnswers: null,
    });
  });

  it("provided answers are evaluated normally", () => {
    expect(decideGating({ eligible: "yes" }, GATING_CONFIG)).toMatchObject({
      gatingPassed: true,
      gatingSource: "recruiter_answered",
    });
    expect(decideGating({ eligible: "no" }, GATING_CONFIG)).toMatchObject({
      gatingPassed: false,
      gatingSource: "recruiter_answered",
    });
  });
});

// ── DB-backed ────────────────────────────────────────────────────────

describe.skipIf(!RUN)("recruiter-added candidates (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(organizations); // cascades to clients/campaigns/candidates/audit

    [fx.orgA] = (
      await db
        .insert(organizations)
        .values({ slug: "man-org-a", name: "Man Org A" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "man-brand-a", name: "Brand A" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.campA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "man-c",
          role_title: "Engineer",
          status: "active",
          gating_config: GATING_CONFIG,
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
    ceiling.over = false;
  });

  function skipInput(overrides: Record<string, unknown> = {}) {
    return {
      orgId: fx.orgA,
      campaignId: fx.campA,
      actorUserId: fx.userA,
      name: "Sourced Person",
      email: `sourced+${Math.floor(performance.now() * 1000)}@example.com`,
      uploadCv: async (id: string) => `cvs/org/brand/${id}/cv.pdf`,
      cvFilename: "cv.pdf",
      cvProvenance: "file" as const,
      gatingAnswers: null,
      gatingConfig: GATING_CONFIG,
      consent: CONSENT,
      ...overrides,
    };
  }

  it("skip + override: vouched candidate lands in the pipeline, fully audited", async () => {
    const res = await addCandidateBySkip(skipInput());

    expect(res.status).toBe("gating_passed");
    expect(res.gatingSource).toBe("recruiter_override");
    expect(res.enqueuedProcessing).toBe(true);
    expect(res.chatTokenRaw).toBeTruthy();

    const c = await candidateRow(res.candidateId);
    expect(c?.status).toBe("gating_passed");
    expect(c?.gating_source).toBe("recruiter_override");
    expect(c?.gating_answers).toBeNull();
    expect(c?.gating_passed).toBe(true);
    expect(c?.source).toBe(RECRUITER_MANUAL_SOURCE);
    expect(c?.popia_consent_at).toBeNull(); // not confirmed by the candidate yet
    expect(c?.consent_attested_by).toBe(fx.userA);
    expect(c?.consent_attested_at).not.toBeNull();
    expect(c?.consent_basis).toBe("verbal");
    expect(c?.chat_token_hash).not.toBeNull();
    expect(c?.data_purge_at).not.toBeNull();

    // Exactly one candidate-processing job for this candidate.
    const jobs = processingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ candidateId: res.candidateId });

    // Four discrete audit rows, with the attestation wording frozen verbatim.
    const audit = await auditFor(res.candidateId);
    const actions = audit.map((a) => a.action).sort();
    expect(actions).toEqual([
      "consent_attested",
      "cv_provided",
      "gating_recorded",
      "manual_add",
    ]);
    const consentRow = audit.find((a) => a.action === "consent_attested");
    expect(consentRow?.metadata).toMatchObject({
      basis: "verbal",
      attestation_version: CURRENT_ATTESTATION,
      wording: CONSENT_ATTESTATIONS[CURRENT_ATTESTATION],
    });
    const gatingRow = audit.find((a) => a.action === "gating_recorded");
    expect(gatingRow?.metadata).toMatchObject({
      gating_source: "recruiter_override",
      gating_passed: true,
    });
  });

  it("skip + pasted CV text: scores from the text, no blob file", async () => {
    const res = await addCandidateBySkip(
      skipInput({
        uploadCv: undefined,
        cvText: "Ten years building distributed systems.",
        cvProvenance: "paste",
        cvFilename: null,
      })
    );

    const c = await candidateRow(res.candidateId);
    expect(c?.cv_text).toContain("distributed systems");
    expect(c?.cv_url).toBeNull();
    expect(res.enqueuedProcessing).toBe(true);
    expect(processingJobs()).toHaveLength(1);
  });

  it("skip + recruiter answers that fail gating: gating_failed, not scored", async () => {
    const res = await addCandidateBySkip(
      skipInput({ gatingAnswers: { eligible: "no" } })
    );

    expect(res.status).toBe("gating_failed");
    expect(res.gatingSource).toBe("recruiter_answered");
    expect(res.enqueuedProcessing).toBe(false);
    expect(processingJobs()).toHaveLength(0);

    const c = await candidateRow(res.candidateId);
    expect(c?.gating_passed).toBe(false);
    expect(c?.gating_source).toBe("recruiter_answered");
    expect(c?.gating_answers).toMatchObject({ eligible: "no" });
  });

  it("skip while over the spend ceiling: created but held (no job)", async () => {
    ceiling.over = true;
    const res = await addCandidateBySkip(skipInput());

    expect(res.status).toBe("gating_passed");
    expect(res.enqueuedProcessing).toBe(false);
    expect(processingJobs()).toHaveLength(0);
  });

  it("invite: creates an invited stub + a 14-day token, no scoring", async () => {
    const before = Date.now();
    const res = await addCandidateByInvite({
      orgId: fx.orgA,
      campaignId: fx.campA,
      actorUserId: fx.userA,
      name: "Invited Person",
      email: "Invited.Person@Example.com",
    });

    expect(res.inviteTokenRaw).toBeTruthy();
    const ttl = res.inviteExpiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(INVITE_TOKEN_TTL_MS - 60_000);
    expect(ttl).toBeLessThan(INVITE_TOKEN_TTL_MS + 60_000);

    const c = await candidateRow(res.candidateId);
    expect(c?.status).toBe(INVITED_STATUS);
    expect(c?.email).toBe("invited.person@example.com"); // normalised
    expect(c?.source).toBe(RECRUITER_MANUAL_SOURCE);
    expect(c?.popia_consent_at).toBeNull();
    expect(c?.gating_passed).toBeNull();
    expect(c?.invite_expires_at?.getTime()).toBe(res.inviteExpiresAt.getTime());

    // A backing chat_tokens row exists with the same expiry.
    const tokenRow = await db.query.chatTokens.findFirst({
      where: eq(chatTokens.candidate_id, res.candidateId),
    });
    expect(tokenRow?.expires_at.getTime()).toBe(res.inviteExpiresAt.getTime());

    // No scoring queued for an invited stub.
    expect(processingJobs()).toHaveLength(0);

    const audit = await auditFor(res.candidateId);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("manual_add");
    expect(audit[0].to_status).toBe(INVITED_STATUS);
  });

  it("invite token: GET-verify does not consume; submit-verify does", async () => {
    const res = await addCandidateByInvite({
      orgId: fx.orgA,
      campaignId: fx.campA,
      actorUserId: fx.userA,
      name: "Peek Person",
      email: "peek@example.com",
    });

    // Render the form (GET) — must NOT burn the token.
    const peek = await verifyMagicLinkToken(res.inviteTokenRaw, { consume: false });
    expect(peek).toBe(res.candidateId);
    const again = await verifyMagicLinkToken(res.inviteTokenRaw, { consume: false });
    expect(again).toBe(res.candidateId);

    // Submit (consume) — now it is one-shot.
    const submit = await verifyMagicLinkToken(res.inviteTokenRaw);
    expect(submit).toBe(res.candidateId);
    const reused = await verifyMagicLinkToken(res.inviteTokenRaw);
    expect(reused).toBeNull();
  });

  it("findCampaignCandidateByEmail matches case-insensitively", async () => {
    const res = await addCandidateBySkip(
      skipInput({ email: "Dedup.Target@Example.com" })
    );
    expect(
      await findCampaignCandidateByEmail(fx.campA, "dedup.target@example.com")
    ).toBe(res.candidateId);
    expect(
      await findCampaignCandidateByEmail(fx.campA, "someone-else@example.com")
    ).toBeNull();
  });

  it("recordConsentConfirmed flips popia_consent_at and audits it", async () => {
    const res = await addCandidateBySkip(skipInput());
    const ok = await recordConsentConfirmed({
      orgId: fx.orgA,
      candidateId: res.candidateId,
    });
    expect(ok).toBe(true);

    const c = await candidateRow(res.candidateId);
    expect(c?.popia_consent_at).not.toBeNull();

    const audit = await auditFor(res.candidateId);
    expect(audit.some((a) => a.action === "consent_confirmed")).toBe(true);

    // Idempotent: a second call (every chat message would fire it) no-ops —
    // no re-stamp, no duplicate audit row.
    const firstConfirmedAt = c?.popia_consent_at;
    const again = await recordConsentConfirmed({
      orgId: fx.orgA,
      candidateId: res.candidateId,
    });
    expect(again).toBe(false);
    const c2 = await candidateRow(res.candidateId);
    expect(c2?.popia_consent_at?.getTime()).toBe(firstConfirmedAt?.getTime());
    const audit2 = await auditFor(res.candidateId);
    expect(audit2.filter((a) => a.action === "consent_confirmed")).toHaveLength(1);
  });

  it("recordOptOut audits the objection", async () => {
    const res = await addCandidateBySkip(skipInput());
    await recordOptOut({
      orgId: fx.orgA,
      candidateId: res.candidateId,
      fromStatus: "gating_passed",
    });
    const audit = await auditFor(res.candidateId);
    const optOut = audit.find((a) => a.action === "opt_out");
    expect(optOut?.from_status).toBe("gating_passed");
    expect(optOut?.to_status).toBe("withdrawn");
  });
});
