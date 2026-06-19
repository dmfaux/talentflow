import { db } from "@/db";
import { organizations } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit, type OperatorAuditAction } from "@/lib/operator-audit";
import type { OrgStatus } from "@/lib/org-status";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// ── Operator org-lifecycle transitions (S11) ────────────────────────
//
// The three reversible state changes (suspend / restore / soft-delete) share
// the audited-mutation shape of the PATCH [id] template (requireApiOperator →
// load → validate transition → mutate → point-in-time audit). Factored here so
// the four thin route files stay declarative; the destructive hard-purge lives
// in its own route (it cascades + needs typed-slug confirmation).

type TransitionKind = "suspend" | "restore" | "soft_delete";

type TransitionSpec = {
  action: OperatorAuditAction;
  /** Human verb for the 409 message. */
  verb: string;
  /** The status this transition lands the org in (idempotent no-op if already there). */
  target: OrgStatus;
  /** Source statuses this transition is legal from. */
  from: OrgStatus[];
  /** Column updates to apply (timestamps stamped from `now`). */
  updates: (now: Date) => Record<string, unknown>;
};

const SPECS: Record<TransitionKind, TransitionSpec> = {
  suspend: {
    action: "suspend",
    verb: "suspend",
    target: "suspended",
    from: ["active"],
    updates: (now) => ({ status: "suspended", suspended_at: now }),
  },
  restore: {
    action: "restore",
    verb: "restore",
    target: "active",
    from: ["suspended", "deleted"],
    // Clear BOTH timestamps so a restore from either state is fully clean.
    updates: () => ({ status: "active", suspended_at: null, deleted_at: null }),
  },
  soft_delete: {
    action: "soft_delete",
    verb: "delete",
    target: "deleted",
    from: ["active", "suspended"],
    updates: (now) => ({ status: "deleted", deleted_at: now }),
  },
};

/** Run one reversible lifecycle transition end-to-end and return the response.
 *  Idempotent: a no-op when the org is already in the target state (no audit
 *  row written). Rejects an illegal source state with 409, a missing org 404. */
export async function runOrgTransition(
  request: NextRequest,
  id: string,
  kind: TransitionKind
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    if (!org) return error("Organisation not found", 404);

    const spec = SPECS[kind];

    // Idempotent re-run: already in the target state → return as-is, no audit.
    if (org.status === spec.target) return success(org);

    if (!spec.from.includes(org.status as OrgStatus)) {
      return error(
        `Cannot ${spec.verb} an organisation that is '${org.status}'`,
        409
      );
    }

    const now = new Date();
    const updates = spec.updates(now);
    const [row] = await db
      .update(organizations)
      .set({ ...updates, updated_at: now })
      .where(eq(organizations.id, id))
      .returning();

    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: spec.action,
      targetOrgId: id,
      metadata: {
        slug: org.slug,
        name: org.name,
        status_before: org.status,
        status_after: updates.status,
      },
      ip: clientIp(request),
      endedAt: now, // point-in-time action (like set_tier)
    });

    return success(row);
  } catch (err) {
    console.error(`POST /api/operator/organizations/[id]/${kind} error:`, err);
    return error("Internal server error", 500);
  }
}
