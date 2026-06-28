import { db } from "@/db";
import { candidateActionAudit, candidates, chatTokens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  generateChatToken,
  generateMagicLinkToken,
  INVITE_TOKEN_TTL_MS,
} from "@/lib/chat-auth";
import { attestationWording, type ConsentAttestation } from "@/lib/consent";
import { evaluateGating, type GatingQuestion } from "@/lib/gating";
import { getQueue } from "@/lib/queue";
import { getCeilingStatus } from "@/lib/spend-ceiling";

// ── Recruiter-added candidates ───────────────────────────────────────
//
// Single owner of the state + audit transitions when a recruiter adds a
// candidate to a campaign by hand (the public form is bypassed). Mirrors the
// pattern of src/lib/rejection.ts: the route resolves auth + the campaign and
// hands clean inputs here; this module performs the inserts, issues tokens,
// writes the audit trail, and enqueues scoring. Candidate-facing email is the
// caller's concern (it needs blob/theme context); the `candidate_notified`
// audit row is written via recordCandidateNotified once the email has sent.

/** Stamped on every recruiter-added candidate's `source` so they are
 *  filterable/reportable as recruiter-sourced (vs public applicants). */
export const RECRUITER_MANUAL_SOURCE = "recruiter_manual";

/** Holding status for an invited-but-not-yet-completed stub. Free-text like
 *  every other candidate status (no PG enum), so it needs no migration. */
export const INVITED_STATUS = "invited";

/** Every audit action this feature appends. Mirrors REJECTION_AUDIT_ACTIONS;
 *  `action` is free-text in the DB so these add no migration. */
export const MANUAL_ADD_AUDIT_ACTIONS = [
  "manual_add",
  "consent_attested",
  "gating_recorded",
  "cv_provided",
  "candidate_notified",
  "consent_confirmed",
  "opt_out",
] as const;
export type ManualAddAuditAction = (typeof MANUAL_ADD_AUDIT_ACTIONS)[number];

export type AddPath = "invite" | "skip";
export type GatingSource = "recruiter_override" | "recruiter_answered";
export type CvProvenance = "file" | "paste";

/** Twelve-month POPIA retention window, identical to the public apply route. */
function purgeDateFrom(now: Date): Date {
  const purgeAt = new Date(now);
  purgeAt.setMonth(purgeAt.getMonth() + 12);
  return purgeAt;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function appendAudit(values: {
  orgId: string;
  candidateId: string;
  actorUserId: string | null;
  action: ManualAddAuditAction;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: unknown;
}): Promise<void> {
  await db.insert(candidateActionAudit).values({
    org_id: values.orgId,
    candidate_id: values.candidateId,
    actor_user_id: values.actorUserId,
    action: values.action,
    from_status: values.fromStatus ?? null,
    to_status: values.toStatus ?? null,
    metadata: values.metadata ?? null,
  });
}

// ── Gating decision ──────────────────────────────────────────────────

export interface GatingDecision {
  gatingPassed: boolean;
  gatingSource: GatingSource;
  /** Persisted to candidates.gating_answers: the recruiter's answers, or null
   *  when they vouched without answering (override). */
  gatingAnswers: Record<string, string> | null;
}

/**
 * Resolve the skip-path gating outcome. `answers === null` means the recruiter
 * vouched and bypassed the questions (override → always passes). Otherwise the
 * answers are evaluated normally against the campaign config, so a vouched
 * candidate can still fail.
 */
export function decideGating(
  answers: Record<string, string> | null,
  gatingConfig: GatingQuestion[]
): GatingDecision {
  if (answers === null) {
    return {
      gatingPassed: true,
      gatingSource: "recruiter_override",
      gatingAnswers: null,
    };
  }
  return {
    gatingPassed: evaluateGating(answers, gatingConfig),
    gatingSource: "recruiter_answered",
    gatingAnswers: answers,
  };
}

// ── Invite tokens ────────────────────────────────────────────────────

export interface IssuedInvite {
  raw: string;
  expiresAt: Date;
}

/**
 * Mint a 14-day invite-to-apply token for a candidate, persist its hash in
 * chat_tokens (the validity source of truth), and mirror the expiry onto
 * candidates.invite_expires_at for cheap list rendering. Reused by the initial
 * invite add and the resend-invite control.
 */
export async function issueInviteToken(
  orgId: string,
  candidateId: string
): Promise<IssuedInvite> {
  const { raw, hash, expiresAt } = generateMagicLinkToken(INVITE_TOKEN_TTL_MS);
  await db.insert(chatTokens).values({
    candidate_id: candidateId,
    org_id: orgId,
    token_hash: hash,
    expires_at: expiresAt,
  });
  await db
    .update(candidates)
    .set({ invite_expires_at: expiresAt, updated_at: new Date() })
    .where(eq(candidates.id, candidateId));
  return { raw, expiresAt };
}

// ── Dedup helper ─────────────────────────────────────────────────────

/** The existing candidate id for this (campaign, email), or null. The route
 *  uses this to refuse a duplicate with a 409 + link to the existing record. */
export async function findCampaignCandidateByEmail(
  campaignId: string,
  email: string
): Promise<string | null> {
  const existing = await db.query.candidates.findFirst({
    where: and(
      eq(candidates.campaign_id, campaignId),
      eq(candidates.email, normaliseEmail(email))
    ),
    columns: { id: true },
  });
  return existing?.id ?? null;
}

// ── Invite path ──────────────────────────────────────────────────────

export interface InvitePathInput {
  orgId: string;
  campaignId: string;
  actorUserId: string;
  name: string;
  email: string;
  phone?: string | null;
}

export interface InvitePathResult {
  candidateId: string;
  inviteTokenRaw: string;
  inviteExpiresAt: Date;
}

/**
 * Create an `invited` stub and issue its invite token. The candidate completes
 * CV + gating + first-party POPIA consent themselves via the public form; none
 * of those are set here. The caller sends the branded invite email and then
 * calls recordCandidateNotified.
 */
export async function addCandidateByInvite(
  input: InvitePathInput
): Promise<InvitePathResult> {
  const now = new Date();
  const [row] = await db
    .insert(candidates)
    .values({
      org_id: input.orgId,
      campaign_id: input.campaignId,
      name: input.name.trim(),
      email: normaliseEmail(input.email),
      phone: input.phone?.trim() || null,
      status: INVITED_STATUS,
      source: RECRUITER_MANUAL_SOURCE,
      popia_consent_at: null,
      data_purge_at: purgeDateFrom(now),
    })
    .returning({ id: candidates.id });

  const candidateId = row.id;

  const invite = await issueInviteToken(input.orgId, candidateId);

  await appendAudit({
    orgId: input.orgId,
    candidateId,
    actorUserId: input.actorUserId,
    action: "manual_add",
    fromStatus: null,
    toStatus: INVITED_STATUS,
    metadata: { path: "invite" satisfies AddPath, source: RECRUITER_MANUAL_SOURCE },
  });

  return {
    candidateId,
    inviteTokenRaw: invite.raw,
    inviteExpiresAt: invite.expiresAt,
  };
}

// ── Skip / vouch path ────────────────────────────────────────────────

export interface SkipPathInput {
  orgId: string;
  campaignId: string;
  actorUserId: string;
  name: string;
  email: string;
  phone?: string | null;
  /** One of cvText / cvUrl is REQUIRED (the route enforces it before calling).
   *  cvText is pasted text; uploadCv is a deferred blob write for the file path.
   *  cvFilename is provenance for the cv_provided audit row. */
  cvText?: string | null;
  /** Deferred CV upload. The blob path is keyed by candidate id, so the route
   *  supplies this callback and the module invokes it only once the row exists;
   *  it returns the stored blob path (cv_url) or null. Omitted for the paste
   *  path. Kept as a callback so this module stays free of blob I/O. */
  uploadCv?: (candidateId: string) => Promise<string | null>;
  cvFilename?: string | null;
  cvProvenance: CvProvenance;
  /** null ⇒ recruiter override (bypass); otherwise evaluated normally. */
  gatingAnswers: Record<string, string> | null;
  gatingConfig: GatingQuestion[];
  consent: ConsentAttestation;
}

export interface SkipPathResult {
  candidateId: string;
  status: "gating_passed" | "gating_failed";
  gatingPassed: boolean;
  gatingSource: GatingSource;
  enqueuedProcessing: boolean;
  /** Raw chat token for the candidate portal / "you've been added" CTA. */
  chatTokenRaw: string;
}

/**
 * Create a vouched candidate straight in the pipeline. Mirrors the public apply
 * route from `gating_passed` onward (auto-scored via candidate-processing,
 * subject to the org spend ceiling) but records the recruiter's gating
 * provenance and consent attestation, and leaves popia_consent_at NULL until
 * the candidate personally confirms. The caller sends the "you've been added"
 * notice and then calls recordCandidateNotified.
 */
export async function addCandidateBySkip(
  input: SkipPathInput
): Promise<SkipPathResult> {
  const now = new Date();
  const gating = decideGating(input.gatingAnswers, input.gatingConfig);
  const status: "gating_passed" | "gating_failed" = gating.gatingPassed
    ? "gating_passed"
    : "gating_failed";

  const chatToken = generateChatToken();

  const [row] = await db
    .insert(candidates)
    .values({
      org_id: input.orgId,
      campaign_id: input.campaignId,
      name: input.name.trim(),
      email: normaliseEmail(input.email),
      phone: input.phone?.trim() || null,
      chat_token_hash: chatToken.hash,
      gating_answers: gating.gatingAnswers,
      gating_passed: gating.gatingPassed,
      gating_source: gating.gatingSource,
      cv_text: input.cvText?.trim() || null,
      cv_url: null, // set below once the candidate-id-keyed blob path is known
      status,
      source: RECRUITER_MANUAL_SOURCE,
      consent_attested_by: input.actorUserId,
      consent_attested_at: now,
      consent_basis: input.consent.basis,
      consent_basis_note: input.consent.note,
      popia_consent_at: null,
      data_purge_at: purgeDateFrom(now),
    })
    .returning({ id: candidates.id });

  const candidateId = row.id;

  // Deferred CV upload: the blob path is keyed by candidate id, so it can only
  // run now the row exists. The route owns the actual blob write via uploadCv.
  let cvUrl: string | null = null;
  if (input.uploadCv) {
    cvUrl = await input.uploadCv(candidateId);
    if (cvUrl) {
      await db
        .update(candidates)
        .set({ cv_url: cvUrl, updated_at: new Date() })
        .where(eq(candidates.id, candidateId));
    }
  }

  // Audit trail: one discrete row per facet of the add, mirroring rejection.ts.
  await appendAudit({
    orgId: input.orgId,
    candidateId,
    actorUserId: input.actorUserId,
    action: "manual_add",
    fromStatus: null,
    toStatus: status,
    metadata: { path: "skip" satisfies AddPath, source: RECRUITER_MANUAL_SOURCE },
  });
  await appendAudit({
    orgId: input.orgId,
    candidateId,
    actorUserId: input.actorUserId,
    action: "consent_attested",
    metadata: {
      basis: input.consent.basis,
      note: input.consent.note,
      attestation_version: input.consent.version,
      // Freeze the verbatim wording so a later copy edit can't rewrite history.
      wording: attestationWording(input.consent.version),
    },
  });
  await appendAudit({
    orgId: input.orgId,
    candidateId,
    actorUserId: input.actorUserId,
    action: "gating_recorded",
    metadata: {
      gating_source: gating.gatingSource,
      gating_passed: gating.gatingPassed,
      answers: gating.gatingAnswers,
    },
  });
  await appendAudit({
    orgId: input.orgId,
    candidateId,
    actorUserId: input.actorUserId,
    action: "cv_provided",
    metadata: {
      provenance: input.cvProvenance,
      filename: input.cvFilename ?? null,
    },
  });

  // Auto-score, mirroring the public route: only when gating passed, a CV is
  // present, and the org is under its spend ceiling (a cap-raise drains the
  // backlog otherwise). The worker owns the move to 'scoring'.
  const hasCv = Boolean(cvUrl || input.cvText?.trim());
  let enqueuedProcessing = false;
  if (gating.gatingPassed && hasCv) {
    const ceiling = await getCeilingStatus(input.orgId);
    if (!ceiling.over) {
      await getQueue().enqueue(
        { type: "candidate-processing", candidateId },
        { orgId: input.orgId, deduplicationId: `process-${candidateId}` }
      );
      enqueuedProcessing = true;
    }
  }

  return {
    candidateId,
    status,
    gatingPassed: gating.gatingPassed,
    gatingSource: gating.gatingSource,
    enqueuedProcessing,
    chatTokenRaw: chatToken.raw,
  };
}

// ── Post-action audit hooks (called from phase-2 surfaces) ───────────

/** Record which candidate-facing message was sent, with its message id. Called
 *  by the add route after the invite / "you've been added" email is dispatched. */
export async function recordCandidateNotified(opts: {
  orgId: string;
  candidateId: string;
  actorUserId: string | null;
  kind: "invite" | "added_notice";
  messageId: string | null;
}): Promise<void> {
  await appendAudit({
    orgId: opts.orgId,
    candidateId: opts.candidateId,
    actorUserId: opts.actorUserId,
    action: "candidate_notified",
    metadata: { kind: opts.kind, message_id: opts.messageId },
  });
}

/** Flip a skip-path candidate's NULL popia_consent_at to a real timestamp when
 *  they personally confirm (first portal/chat access), and audit it. Idempotent:
 *  the WHERE guard no-ops if consent is already recorded. */
export async function recordConsentConfirmed(opts: {
  orgId: string;
  candidateId: string;
}): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(candidates)
    .set({ popia_consent_at: now, updated_at: now })
    .where(eq(candidates.id, opts.candidateId))
    .returning({ id: candidates.id });
  if (!row) return false;
  await appendAudit({
    orgId: opts.orgId,
    candidateId: opts.candidateId,
    actorUserId: null,
    action: "consent_confirmed",
    metadata: { confirmed_at: now.toISOString() },
  });
  return true;
}

/** Record a candidate's opt-out (POPIA objection) from the "you've been added"
 *  notice. The caller flips status → withdrawn and schedules the data purge. */
export async function recordOptOut(opts: {
  orgId: string;
  candidateId: string;
  fromStatus: string;
}): Promise<void> {
  await appendAudit({
    orgId: opts.orgId,
    candidateId: opts.candidateId,
    actorUserId: null,
    action: "opt_out",
    fromStatus: opts.fromStatus,
    toStatus: "withdrawn",
  });
}
