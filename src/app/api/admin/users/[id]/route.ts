import { db } from "@/db";
import { clients, memberships, users } from "@/db/schema";
import {
  authorizeApiOrg,
  effectiveOrgRole,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { ROLE_RANK, roleRank } from "@/lib/rbac";
import { type OrgRole } from "@/lib/auth";
import { and, eq, ne } from "drizzle-orm";
import { NextRequest } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Org-role assignment authority (Resolved Decision 5): an org_admin+ actor may
 *  grant a target an org_role of rank ≤ their own. A null target is allowed. */
function canAssignOrgRole(
  actor: OrgRole | null,
  target: OrgRole | null
): boolean {
  if (target === null) return true;
  if (!actor) return false;
  return ROLE_RANK[target] <= ROLE_RANK[actor];
}

/** An actor may not modify a target who outranks them — e.g. an org_admin
 *  cannot touch an owner (Resolved Decision 5). */
function outranksActor(
  targetRole: string | null,
  actor: OrgRole | null
): boolean {
  return roleRank(targetRole) > (actor ? ROLE_RANK[actor] : -1);
}

/** True when no OTHER active owner remains in the org — used to block demoting
 *  or deactivating the last active owner into a lockout. */
async function isLastActiveOwner(
  orgId: string,
  targetUserId: string
): Promise<boolean> {
  const others = await db.query.users.findMany({
    where: and(
      eq(users.org_id, orgId),
      eq(users.org_role, "owner"),
      eq(users.is_active, true),
      eq(users.is_operator, false),
      ne(users.id, targetUserId)
    ),
    columns: { id: true },
  });
  return others.length === 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // S8: close the S4 read carry-over — was requireApiAuth() resolving ANY user
  // by raw UUID across all orgs. Now org-scoped via resolveOwnedResource; a
  // cross-org id or an operator → 404 (indistinguishable from "does not exist").
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const row = await resolveOwnedResource(users, id, ctx);
    if (!row || row.is_operator) return error("User not found", 404);

    // Membership view: the brands this member can act in (org-level owners/admins
    // carry none and span every brand). This replaces the legacy single-brand
    // users.client_id display/edit, dropped in S13.
    const mships = await db
      .select({
        client_id: memberships.client_id,
        client_name: clients.name,
        brand_role: memberships.brand_role,
      })
      .from(memberships)
      .innerJoin(clients, eq(memberships.client_id, clients.id))
      .where(eq(memberships.user_id, row.id));

    return success({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      org_role: row.org_role,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      memberships: mships,
    });
  } catch (err) {
    console.error("GET /api/admin/users/[id] error:", err);
    return error("Internal server error", 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may manage members.
  const denied = authorizeApiOrg(ctx, "manage_member");
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await request.json();

    // Target must be in the actor's org and a non-operator (operators and
    // other orgs are invisible → 404, never a cross-org move).
    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.id, id),
        orgScope(users, ctx),
        eq(users.is_operator, false)
      ),
      columns: { id: true, org_role: true },
    });
    if (!existing) return error("User not found", 404);

    const actorRole = effectiveOrgRole(ctx);

    // An org_admin cannot modify an owner (no touching a higher-ranked target).
    if (outranksActor(existing.org_role, actorRole)) {
      return error("Forbidden", 403);
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (body.firstName !== undefined) {
      const v = typeof body.firstName === "string" ? body.firstName.trim() : "";
      if (!v) return error("First name cannot be empty");
      updates.first_name = v;
    }

    if (body.lastName !== undefined) {
      const v = typeof body.lastName === "string" ? body.lastName.trim() : "";
      if (!v) return error("Last name cannot be empty");
      updates.last_name = v;
    }

    if (body.email !== undefined) {
      const v = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!v || !EMAIL_RE.test(v)) return error("A valid email is required");

      // Email is unique per-org now (S1) — scope the collision check.
      const taken = await db.query.users.findFirst({
        where: and(
          eq(users.org_id, ctx.effectiveOrgId!),
          eq(users.email, v),
          ne(users.id, id)
        ),
        columns: { id: true },
      });
      if (taken) return error("A user with this email already exists");
      updates.email = v;
    }

    // Org-role change: rank-bounded, owner-protected, last-owner-safe.
    if (body.orgRole !== undefined) {
      const newRole: OrgRole | null =
        body.orgRole === null || body.orgRole === "" ? null : body.orgRole;
      if (newRole !== null && newRole !== "owner" && newRole !== "org_admin") {
        return error("org_role must be owner or org_admin");
      }
      if (!canAssignOrgRole(actorRole, newRole)) {
        return error("Forbidden: cannot grant an org role above your own", 403);
      }
      if (
        existing.org_role === "owner" &&
        newRole !== "owner" &&
        (await isLastActiveOwner(ctx.effectiveOrgId!, id))
      ) {
        return error(
          "Cannot demote the last active owner of the organisation",
          409
        );
      }
      updates.org_role = newRole;
    }

    if (body.isActive !== undefined) {
      const nextActive = Boolean(body.isActive);
      if (!nextActive) {
        if (id === ctx.userId) {
          return error("You cannot deactivate your own account", 409);
        }
        if (
          existing.org_role === "owner" &&
          (await isLastActiveOwner(ctx.effectiveOrgId!, id))
        ) {
          return error(
            "Cannot deactivate the last active owner of the organisation",
            409
          );
        }
      }
      updates.is_active = nextActive;
    }

    const returnCols = {
      id: users.id,
      first_name: users.first_name,
      last_name: users.last_name,
      email: users.email,
      org_role: users.org_role,
      is_active: users.is_active,
      updated_at: users.updated_at,
    };

    // Promoting a brand-scoped Member to an org-level role (owner/org_admin)
    // makes their per-brand memberships dead data — decideBrandAccess spans all
    // brands for org-level roles and never consults memberships. Clear them in
    // the same unit so the membership view reflects the role (a later demote
    // back to Member starts from a clean slate, not stale brands).
    const promotingToOrgLevel =
      existing.org_role === null && updates.org_role != null;

    const row = promotingToOrgLevel
      ? await db.transaction(async (tx) => {
          const [r] = await tx
            .update(users)
            .set(updates)
            .where(eq(users.id, id))
            .returning(returnCols);
          await tx.delete(memberships).where(eq(memberships.user_id, id));
          return r;
        })
      : (await db.update(users).set(updates).where(eq(users.id, id)).returning(returnCols))[0];

    return success(row);
  } catch (err) {
    console.error("PATCH /api/admin/users/[id] error:", err);
    return error("Internal server error", 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may deactivate members.
  const denied = authorizeApiOrg(ctx, "manage_member");
  if (denied) return denied;

  try {
    const { id } = await params;

    // Target must be in the actor's org and a non-operator → 404 otherwise.
    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.id, id),
        orgScope(users, ctx),
        eq(users.is_operator, false)
      ),
      columns: { id: true, org_role: true },
    });
    if (!existing) return error("User not found", 404);

    // An org_admin cannot deactivate an owner.
    if (outranksActor(existing.org_role, effectiveOrgRole(ctx))) {
      return error("Forbidden", 403);
    }

    // Block self-deactivation and last-active-owner lockout.
    if (id === ctx.userId) {
      return error("You cannot deactivate your own account", 409);
    }
    if (
      existing.org_role === "owner" &&
      (await isLastActiveOwner(ctx.effectiveOrgId!, id))
    ) {
      return error(
        "Cannot deactivate the last active owner of the organisation",
        409
      );
    }

    await db
      .update(users)
      .set({ is_active: false, updated_at: new Date() })
      .where(eq(users.id, id));

    return success({ id });
  } catch (err) {
    console.error("DELETE /api/admin/users/[id] error:", err);
    return error("Internal server error", 500);
  }
}
