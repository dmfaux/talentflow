// ── Spend-ceiling enforcement (Phase 4) ─────────────────────────────
//
// The downside cap. At the org's effective credit ceiling for the period we
// PAUSE new scoring intake (skip the candidate-processing enqueue) while letting
// in-flight scoring + open chats drain. Fully opt-in: with no ceiling configured
// the cheap path returns immediately and nothing changes.

import { db } from "@/db";
import { candidates, organizations, plans } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { creditsForOrgSince, startOfCurrentMonth } from "@/lib/pricing";
import { getQueue } from "@/lib/queue";

export interface CeilingStatus {
  /** organizations.hard_ceiling_credits ?? plans.hard_ceiling_credits; null = uncapped. */
  effectiveCeiling: number | null;
  /** Calendar-month-to-date billed credits (0 when uncapped — not computed). */
  periodCredits: number;
  /** A ceiling is set AND period credits have reached it → pause new intake. */
  over: boolean;
}

/**
 * Whether an org has reached its spend ceiling this billing period. Cheap-path
 * first: when no ceiling is configured (the default) this returns WITHOUT summing
 * any usage, so the public application hot path pays nothing until a ceiling is
 * set. Takes a raw orgId (enforcement, not a tenant read).
 */
export async function getCeilingStatus(orgId: string): Promise<CeilingStatus> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { tier: true, hard_ceiling_credits: true },
  });
  if (!org) return { effectiveCeiling: null, periodCredits: 0, over: false };

  let effectiveCeiling = org.hard_ceiling_credits;
  if (effectiveCeiling == null) {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.tier, org.tier),
      columns: { hard_ceiling_credits: true },
    });
    effectiveCeiling = plan?.hard_ceiling_credits ?? null;
  }
  if (effectiveCeiling == null) {
    return { effectiveCeiling: null, periodCredits: 0, over: false };
  }

  const periodCredits = await creditsForOrgSince(orgId, startOfCurrentMonth());
  return { effectiveCeiling, periodCredits, over: periodCredits >= effectiveCeiling };
}

/**
 * Re-enqueue every held candidate for an org — those parked at gating_passed with
 * a stored CV because intake was paused at the ceiling. The "process-<id>" dedup
 * key makes this idempotent against any already-live job, so it is safe to call
 * on every cap-raise. Returns the number of candidates enqueued.
 */
export async function resumeOrgIntake(orgId: string): Promise<number> {
  const held = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(
        eq(candidates.org_id, orgId),
        eq(candidates.status, "gating_passed"),
        eq(candidates.gating_passed, true),
        isNotNull(candidates.cv_url),
      ),
    );

  const queue = getQueue();
  for (const c of held) {
    await queue.enqueue(
      { type: "candidate-processing", candidateId: c.id },
      { orgId, deduplicationId: `process-${c.id}` },
    );
  }
  return held.length;
}
