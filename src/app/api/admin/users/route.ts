import { db } from "@/db";
import { clients, memberships, users } from "@/db/schema";
import {
  authorizeApiOrg,
  effectiveOrgRole,
  error,
  getApiTenant,
  requireApiAuth,
  success,
} from "@/lib/api";
import { hashPassword, type OrgRole } from "@/lib/auth";
import { resolveOwnedResource } from "@/lib/tenant";
import { ROLE_RANK } from "@/lib/rbac";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const BRAND_ROLES = ["brand_admin", "recruiter", "viewer"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Legacy security_group is NOT NULL until S13 and no longer gates anything;
// write a fixed default so creation works without exposing it to callers.
const LEGACY_SECURITY_GROUP = "user";

/** Org-role assignment authority (Resolved Decision 5): an org_admin+ actor may
 *  grant a target an org_role of rank ≤ their own (owner → owner/org_admin;
 *  org_admin → org_admin, never owner). A null target (plain brand member) is
 *  always allowed. */
function canAssignOrgRole(
  actor: OrgRole | null,
  target: OrgRole | null
): boolean {
  if (target === null) return true;
  if (!actor) return false;
  return ROLE_RANK[target] <= ROLE_RANK[actor];
}

export async function GET() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const rows = await db
      .select({
        id: users.id,
        first_name: users.first_name,
        last_name: users.last_name,
        email: users.email,
        security_group: users.security_group,
        client_id: users.client_id,
        client_name: clients.name,
        is_active: users.is_active,
        created_at: users.created_at,
        updated_at: users.updated_at,
      })
      .from(users)
      .leftJoin(clients, eq(users.client_id, clients.id))
      .orderBy(desc(users.created_at));
    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/users error:", err);
    return error("Internal server error", 500);
  }
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may create members.
  const denied = authorizeApiOrg(ctx, "manage_member");
  if (denied) return denied;

  try {
    const body = await request.json();
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const brandRole = typeof body.brandRole === "string" ? body.brandRole : "viewer";
    const clientId = typeof body.clientId === "string" ? body.clientId : "";

    if (!firstName) return error("First name is required");
    if (!lastName) return error("Last name is required");
    if (!emailRaw || !EMAIL_RE.test(emailRaw)) return error("A valid email is required");
    if (password.length < 8) return error("Password must be at least 8 characters");
    if (!BRAND_ROLES.includes(brandRole as (typeof BRAND_ROLES)[number])) {
      return error("Brand role must be brand_admin, recruiter, or viewer");
    }
    if (!clientId) return error("Brand is required");

    // Optional org_role grant — null (plain brand member) unless explicitly
    // requested, and only within the actor's authority (no escalation).
    let orgRoleToSet: OrgRole | null = null;
    if (body.orgRole !== undefined && body.orgRole !== null && body.orgRole !== "") {
      if (body.orgRole !== "owner" && body.orgRole !== "org_admin") {
        return error("org_role must be owner or org_admin");
      }
      if (!canAssignOrgRole(effectiveOrgRole(ctx), body.orgRole)) {
        return error("Forbidden: cannot grant an org role above your own", 403);
      }
      orgRoleToSet = body.orgRole;
    }

    // The brand to grant must belong to the actor's org (never trust a body
    // clientId to cross orgs). A cross-org/non-existent id → 404.
    const brand = await resolveOwnedResource(clients, clientId, ctx);
    if (!brand) return error("Selected brand does not exist", 404);

    // Email is unique per-org now (S1); a global check would wrongly collide
    // across tenants. Bind the lookup to the actor's org.
    const existing = await db.query.users.findFirst({
      where: and(eq(users.org_id, ctx.effectiveOrgId!), eq(users.email, emailRaw)),
      columns: { id: true },
    });
    if (existing) return error("A user with this email already exists");

    const passwordHash = await hashPassword(password);

    const [row] = await db
      .insert(users)
      .values({
        // Bind to the actor's org; never trust a body org_id.
        org_id: ctx.effectiveOrgId!,
        client_id: brand.id,
        org_role: orgRoleToSet,
        is_operator: false,
        first_name: firstName,
        last_name: lastName,
        email: emailRaw,
        password_hash: passwordHash,
        security_group: LEGACY_SECURITY_GROUP,
      })
      .returning({
        id: users.id,
        org_id: users.org_id,
        first_name: users.first_name,
        last_name: users.last_name,
        email: users.email,
        org_role: users.org_role,
        client_id: users.client_id,
        is_active: users.is_active,
        created_at: users.created_at,
      });

    // One membership row granting the brand role. Idempotent against the
    // unique(user_id, client_id) constraint — update the role on conflict.
    await db
      .insert(memberships)
      .values({ user_id: row.id, client_id: brand.id, brand_role: brandRole })
      .onConflictDoUpdate({
        target: [memberships.user_id, memberships.client_id],
        set: { brand_role: brandRole, updated_at: new Date() },
      });

    return success({ ...row, brand_role: brandRole }, 201);
  } catch (err) {
    console.error("POST /api/admin/users error:", err);
    return error("Internal server error", 500);
  }
}
