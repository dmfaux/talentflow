import { db } from "@/db";
import { clients, memberships, users } from "@/db/schema";
import {
  authorizeApiOrg,
  effectiveOrgRole,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { type OrgRole } from "@/lib/auth";
import { ROLE_RANK, roleRank } from "@/lib/rbac";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

/** An actor may not modify a target who outranks them — e.g. an org_admin
 *  cannot touch an owner (mirrors users/[id] PATCH, Resolved Decision 5). */
function outranksActor(targetRole: string | null, actor: OrgRole | null): boolean {
  return roleRank(targetRole) > (actor ? ROLE_RANK[actor] : -1);
}

// Remove one brand membership from a member. Idempotent: removing a brand the
// user isn't a member of is a no-op success, so the UI never has to special-case
// a stale chip.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; clientId: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may manage members.
  const denied = authorizeApiOrg(ctx, "manage_member");
  if (denied) return denied;

  try {
    const { id, clientId } = await params;

    // Target must be in the actor's org and a non-operator → 404 otherwise.
    const target = await db.query.users.findFirst({
      where: and(
        eq(users.id, id),
        orgScope(users, ctx),
        eq(users.is_operator, false)
      ),
      columns: { id: true, org_role: true },
    });
    if (!target) return error("User not found", 404);

    // An org_admin cannot modify an owner.
    if (outranksActor(target.org_role, effectiveOrgRole(ctx))) {
      return error("Forbidden", 403);
    }

    // The brand must belong to the actor's org (don't allow a cross-org delete
    // probe by raw id). A cross-org/non-existent brand → 404.
    const brand = await resolveOwnedResource(clients, clientId, ctx);
    if (!brand) return error("Membership not found", 404);

    await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.user_id, target.id),
          eq(memberships.client_id, brand.id)
        )
      );

    return success({ id, client_id: brand.id });
  } catch (err) {
    console.error(
      "DELETE /api/admin/users/[id]/memberships/[clientId] error:",
      err
    );
    return error("Internal server error", 500);
  }
}
