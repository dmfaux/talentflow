import { db } from "@/db";
import { clients, organizations, users } from "@/db/schema";
import {
  authorizeApiOrg,
  effectiveOrgRole,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { type OrgRole } from "@/lib/auth";
import {
  createInvitationRow,
  InvitationConflictError,
  sendInviteEmail,
} from "@/lib/invitations";
import { resolveOwnedResource } from "@/lib/tenant";
import { ROLE_RANK } from "@/lib/rbac";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const BRAND_ROLES = ["brand_admin", "recruiter", "viewer"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An org_admin+ actor may grant a target an org_role of rank ≤ their own
 *  (owner → owner/org_admin; org_admin → org_admin, never owner). */
function canAssignOrgRole(actor: OrgRole | null, target: OrgRole): boolean {
  if (!actor) return false;
  return ROLE_RANK[target] <= ROLE_RANK[actor];
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may invite members (same gate as users POST).
  const denied = authorizeApiOrg(ctx, "manage_member");
  if (denied) return denied;

  try {
    const body = await request.json();
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const brandRole = typeof body.brandRole === "string" ? body.brandRole : "";
    const orgRoleRaw = typeof body.orgRole === "string" ? body.orgRole : "";

    if (!email || !EMAIL_RE.test(email)) {
      return error("A valid email is required");
    }

    // ── Brand invite vs org-level invite ────────────────────────────
    let clientIdToSet: string | null = null;
    let brandRoleToSet: string | null = null;
    let orgRoleToSet: OrgRole | null = null;

    if (clientId) {
      // Brand invite: the brand must belong to the actor's org (never trust a
      // body clientId to cross orgs). A cross-org/non-existent id → 404.
      const brand = await resolveOwnedResource(clients, clientId, ctx);
      if (!brand) return error("Selected brand does not exist", 404);
      if (!BRAND_ROLES.includes(brandRole as (typeof BRAND_ROLES)[number])) {
        return error("Brand role must be brand_admin, recruiter, or viewer");
      }
      clientIdToSet = brand.id;
      brandRoleToSet = brandRole;
    } else {
      // Org-level invite (Owner/Org-Admin spanning every brand): the accepted
      // user gets client_id: null (S9 empty-org bootstrap, Resolved Decision 1).
      if (orgRoleRaw !== "owner" && orgRoleRaw !== "org_admin") {
        return error(
          "Select a brand + brand role, or an org role (owner/org_admin)"
        );
      }
      if (!canAssignOrgRole(effectiveOrgRole(ctx), orgRoleRaw)) {
        return error("Forbidden: cannot grant an org role above your own", 403);
      }
      orgRoleToSet = orgRoleRaw;
    }

    // ── Mint the invite via the shared verified core (global-email guard
    //    + pending-supersede + token). Reused by operator provisioning (S9). ──
    let invitation, rawToken;
    try {
      ({ invitation, rawToken } = await createInvitationRow({
        orgId: ctx.effectiveOrgId!,
        email,
        clientId: clientIdToSet,
        orgRole: orgRoleToSet,
        brandRole: brandRoleToSet,
        invitedBy: ctx.userId,
      }));
    } catch (e) {
      if (e instanceof InvitationConflictError) {
        return e.sameOrg
          ? error("A member with this email already exists", 409)
          : error("This email is already in use", 409);
      }
      throw e;
    }

    // ── Send the invite (best-effort, like password reset) ──────────
    const [org, inviter] = await Promise.all([
      db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.effectiveOrgId!),
        columns: { name: true },
      }),
      db.query.users.findFirst({
        where: eq(users.id, ctx.userId),
        columns: { first_name: true, last_name: true },
      }),
    ]);
    const inviterName = inviter
      ? `${inviter.first_name} ${inviter.last_name}`.trim()
      : "";
    const acceptUrl = `${request.nextUrl.origin}/accept-invite?token=${rawToken}`;
    await sendInviteEmail(email, org?.name ?? "TalentStream", inviterName, acceptUrl);

    return success(invitation, 201);
  } catch (err) {
    console.error("POST /api/admin/members/invite error:", err);
    return error("Internal server error", 500);
  }
}
