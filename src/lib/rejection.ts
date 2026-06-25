import { db } from "@/db";
import { candidates, candidateActionAudit } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getQueue } from "@/lib/queue";

// ── Human-in-the-loop rejection ──────────────────────────────────────
//
// The AI may RECOMMEND a rejection (parking a candidate in `pending_rejection`)
// but a human must ACCEPT it before the candidate is actually rejected and a
// rejection email goes out. Every human decision — and the AI's original
// recommendation — is recorded in candidate_action_audit (who, when, optional
// reason). This module is the single owner of those transitions, shared by the
// scoring pipeline (recommend), the admin API (accept/dismiss), and the bulk
// endpoint.

/** Status a dismissed candidate returns to: a neutral "kept, decide later".
 *  Further routing (shortlist, chat) happens through the normal candidate UI. */
export const DISMISS_TARGET_STATUS = "scored";

export const REJECTION_AUDIT_ACTIONS = [
  "reject_recommended",
  "reject_accepted",
  "reject_dismissed",
] as const;
export type RejectionAuditAction = (typeof REJECTION_AUDIT_ACTIONS)[number];

/** Non-PII snapshot of the AI's reasoning, frozen into the audit row so the
 *  trail survives a POPIA candidate purge. Never holds candidate PII. */
export interface RejectionAiSnapshot {
  ai_score: number | null;
  recommendation: string | null;
  min_score: number | null;
  ai_rationale: string | null;
}

/** Minimal candidate shape every decision needs. Callers load it org-scoped. */
export interface RejectionCandidate {
  id: string;
  org_id: string;
  status: string;
  rejection_reason: string | null;
  ai_score: number | null;
  ai_rationale: string | null;
}

export type RejectionDecisionResult =
  | { ok: true; status: "rejected" | typeof DISMISS_TARGET_STATUS }
  /** The candidate was no longer in pending_rejection (already actioned, or a
   *  stale UI) — the transition was a no-op. */
  | { ok: false; code: "not_pending" };

/** Record that the AI recommended rejecting a candidate. A SYSTEM action — no
 *  human actor (actor_user_id stays null). The candidate row itself is updated
 *  by the scoring pipeline; this only appends the audit row. */
export async function recordRejectionRecommended(opts: {
  orgId: string;
  candidateId: string;
  fromStatus: string;
  snapshot: RejectionAiSnapshot;
}): Promise<void> {
  await db.insert(candidateActionAudit).values({
    org_id: opts.orgId,
    candidate_id: opts.candidateId,
    actor_user_id: null,
    action: "reject_recommended",
    from_status: opts.fromStatus,
    to_status: "pending_rejection",
    metadata: opts.snapshot,
  });
}

/** Accept the AI's rejection recommendation. The status guard lives in the
 *  UPDATE's WHERE clause (status = 'pending_rejection') so two recruiters racing
 *  to accept the same candidate can't both transition it or double-send the
 *  email. On success: candidate → rejected, audit appended, rejection email
 *  queued (with the human's reason appended as candidate-facing feedback when
 *  `notifyCandidate`). */
export async function acceptRejection(opts: {
  candidate: RejectionCandidate;
  actorUserId: string;
  reason?: string | null;
  notifyCandidate?: boolean;
  minScore?: number | null;
}): Promise<RejectionDecisionResult> {
  const reason = opts.reason?.trim() || null;
  // Can only forward the reason to the candidate if there IS one.
  const notify = Boolean(opts.notifyCandidate) && reason !== null;

  // A human-provided reason supersedes the AI's recommendation text as the
  // recorded rejection_reason; otherwise keep the AI text already on the row.
  const finalReason = reason ?? opts.candidate.rejection_reason;

  const [row] = await db
    .update(candidates)
    .set({
      status: "rejected",
      rejection_reason: finalReason,
      rejection_recommended_at: null,
      rejection_reminded_at: null,
      pending_rejection_at: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(candidates.id, opts.candidate.id),
        eq(candidates.status, "pending_rejection")
      )
    )
    .returning({ id: candidates.id });

  if (!row) return { ok: false, code: "not_pending" };

  await db.insert(candidateActionAudit).values({
    org_id: opts.candidate.org_id,
    candidate_id: opts.candidate.id,
    actor_user_id: opts.actorUserId,
    action: "reject_accepted",
    from_status: "pending_rejection",
    to_status: "rejected",
    reason,
    reason_sent_to_candidate: notify,
    metadata: {
      ai_score: opts.candidate.ai_score,
      ai_rationale: opts.candidate.ai_rationale,
      min_score: opts.minScore ?? null,
    },
  });

  await getQueue().enqueue(
    {
      type: "send-email",
      candidateId: opts.candidate.id,
      emailKind: "rejected",
      ...(notify && reason ? { adminReason: reason } : {}),
    },
    {
      orgId: opts.candidate.org_id,
      deduplicationId: `rejected-${opts.candidate.id}`,
    }
  );

  return { ok: true, status: "rejected" };
}

/** Dismiss the AI's rejection recommendation — the human disagrees. Candidate
 *  returns to `scored`; the AI's recommendation reason is cleared. No email.
 *  Same race-safe status guard as acceptRejection. */
export async function dismissRejection(opts: {
  candidate: RejectionCandidate;
  actorUserId: string;
  reason?: string | null;
}): Promise<RejectionDecisionResult> {
  const reason = opts.reason?.trim() || null;

  const [row] = await db
    .update(candidates)
    .set({
      status: DISMISS_TARGET_STATUS,
      rejection_reason: null,
      rejection_recommended_at: null,
      rejection_reminded_at: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(candidates.id, opts.candidate.id),
        eq(candidates.status, "pending_rejection")
      )
    )
    .returning({ id: candidates.id });

  if (!row) return { ok: false, code: "not_pending" };

  await db.insert(candidateActionAudit).values({
    org_id: opts.candidate.org_id,
    candidate_id: opts.candidate.id,
    actor_user_id: opts.actorUserId,
    action: "reject_dismissed",
    from_status: "pending_rejection",
    to_status: DISMISS_TARGET_STATUS,
    reason,
    reason_sent_to_candidate: false,
    metadata: {
      ai_score: opts.candidate.ai_score,
      ai_rationale: opts.candidate.ai_rationale,
    },
  });

  return { ok: true, status: DISMISS_TARGET_STATUS };
}

export interface CandidateAuditEntry {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  reason_sent_to_candidate: boolean;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  metadata: unknown;
  created_at: Date;
}

/** The full, newest-first action trail for a candidate, with each human actor's
 *  name/email resolved. Used by the candidate detail UI to show who decided
 *  what, when, and why. */
export async function getCandidateAuditTrail(
  candidateId: string
): Promise<CandidateAuditEntry[]> {
  const rows = await db.query.candidateActionAudit.findMany({
    where: eq(candidateActionAudit.candidate_id, candidateId),
    orderBy: [desc(candidateActionAudit.created_at)],
    with: {
      actor: { columns: { first_name: true, last_name: true, email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    from_status: r.from_status,
    to_status: r.to_status,
    reason: r.reason,
    reason_sent_to_candidate: r.reason_sent_to_candidate,
    actor_user_id: r.actor_user_id,
    actor_name: r.actor
      ? `${r.actor.first_name} ${r.actor.last_name}`.trim()
      : null,
    actor_email: r.actor?.email ?? null,
    metadata: r.metadata,
    created_at: r.created_at,
  }));
}
