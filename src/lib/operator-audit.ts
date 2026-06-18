import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { operatorAudit } from "@/db/schema";

// ── Operator audit trail (S7) ────────────────────────────────────────
//
// operator_audit.action is open free-text in the schema, validated against this
// in-code allow-list — so S9 (provision_org) and S11 (suspend|restore|
// soft_delete|purge) extend the set by editing this array, with no migration.

export const OPERATOR_AUDIT_ACTIONS = [
  "impersonate",
  "impersonate_exit",
  "set_tier",
  "set_billing_email",
  "provision_org", // S9: operator provisions an org + first Owner (resend reuses this with metadata.resend)
  // S11 org lifecycle. purge_org snapshots slug/name/counts in metadata so the
  // row stays queryable after the cascade nulls operator_audit.target_org_id.
  "suspend",
  "restore",
  "soft_delete",
  "purge_org",
] as const;

export type OperatorAuditAction = (typeof OPERATOR_AUDIT_ACTIONS)[number];

export function isOperatorAuditAction(
  value: unknown
): value is OperatorAuditAction {
  return (
    typeof value === "string" &&
    (OPERATOR_AUDIT_ACTIONS as readonly string[]).includes(value)
  );
}

/** Append an operator_audit row. Point-in-time actions (set_tier /
 *  set_billing_email) pass endedAt=now so started_at === ended_at; an
 *  impersonate session leaves endedAt null and is closed later by exit /
 *  re-impersonate (see closeOpenActAsSessions). */
export async function recordOperatorAudit(entry: {
  operatorUserId: string;
  action: OperatorAuditAction;
  targetOrgId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  endedAt?: Date | null;
}): Promise<void> {
  await db.insert(operatorAudit).values({
    operator_user_id: entry.operatorUserId,
    action: entry.action,
    target_org_id: entry.targetOrgId ?? null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
    ended_at: entry.endedAt ?? null,
  });
}

/** Close any open impersonate session rows for an operator (ended_at IS NULL).
 *  Called on explicit exit and before a re-impersonate, so act-as sessions
 *  never overlap. A no-op when there is no open session. */
export async function closeOpenActAsSessions(
  operatorUserId: string
): Promise<void> {
  await db
    .update(operatorAudit)
    .set({ ended_at: new Date() })
    .where(
      and(
        eq(operatorAudit.operator_user_id, operatorUserId),
        eq(operatorAudit.action, "impersonate"),
        isNull(operatorAudit.ended_at)
      )
    );
}
