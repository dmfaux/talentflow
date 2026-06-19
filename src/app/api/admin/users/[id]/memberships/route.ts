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

const BRAND_ROLES = ["brand_admin", "recruiter", "viewer"] as const;

/** An actor may not modify a target who outranks them — e.g. an org_admin
 *  cannot touch an owner (mirrors users/[id] PATCH, Resolved Decision 5). */
function outranksActor(targetRole: string | null, actor: OrgRole | null): boolean {
  return roleRank(targetRole) > (actor ? ROLE_RANK[actor] : -1);
}

// Add (or re-role) a brand membership for a brand-scoped member. The companion
// to the invite flow, which only ever seats a NEW user into ONE brand: this is
// the path that links an EXISTING member to additional brands (the gap the
// invitations core's "edited via users PATCH" comment promised but never built).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may manage members (same gate as users PATCH).
  const denied = authorizeApiOrg(ctx, "manage_member");
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await request.json();
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const brandRole = typeof body.brandRole === "string" ? body.brandRole : "";

    // Target must be in the actor's org and a non-operator (operators and other
    // orgs are invisible → 404, never a cross-org reach).
    const target = await db.query.users.findFirst({
      where: and(
        eq(users.id, id),
        orgScope(users, ctx),
        eq(users.is_operator, false)
      ),
      columns: { id: true, org_role: true },
    });
    if (!target) return error("User not found", 404);

    // An org_admin cannot modify an owner (no touching a higher-ranked target).
    if (outranksActor(target.org_role, effectiveOrgRole(ctx))) {
      return error("Forbidden", 403);
    }

    // Org-level users (owner/org_admin) already span every brand via
    // decideBrandAccess, which never consults memberships for them — so a
    // membership row would be dead data. Keep the model clean: only brand-scoped
    // Members hold memberships. Demote to Member first to scope them to brands.
    if (target.org_role) {
      return error(
        "Org-level users already have access to all brands. Change their role to Member first.",
        409
      );
    }

    if (!BRAND_ROLES.includes(brandRole as (typeof BRAND_ROLES)[number])) {
      return error("Brand role must be brand_admin, recruiter, or viewer");
    }

    // The brand must belong to the actor's org (never trust a body clientId to
    // cross orgs). A cross-org/non-existent id → 404.
    const brand = await resolveOwnedResource(clients, clientId, ctx);
    if (!brand) return error("Selected brand does not exist", 404);

    // Upsert on (user_id, client_id) so re-adding a brand just updates the role.
    await db
      .insert(memberships)
      .values({ user_id: target.id, client_id: brand.id, brand_role: brandRole })
      .onConflictDoUpdate({
        target: [memberships.user_id, memberships.client_id],
        set: { brand_role: brandRole, updated_at: new Date() },
      });

    return success(
      { client_id: brand.id, client_name: brand.name, brand_role: brandRole },
      201
    );
  } catch (err) {
    console.error("POST /api/admin/users/[id]/memberships error:", err);
    return error("Internal server error", 500);
  }
}
