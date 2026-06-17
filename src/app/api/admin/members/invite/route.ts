import { db } from "@/db";
import { clients, invitations, organizations, users } from "@/db/schema";
import {
  authorizeApiOrg,
  effectiveOrgRole,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { generateInviteToken, type OrgRole } from "@/lib/auth";
import { invitationEmail, sendTransactionalEmail } from "@/lib/email";
import { resolveOwnedResource } from "@/lib/tenant";
import { ROLE_RANK } from "@/lib/rbac";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";

const BRAND_ROLES = ["brand_admin", "recruiter", "viewer"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Colleague-actioned async, so the 1h reset-token TTL is far too short. 7 days
// matches the GitHub/Slack/Linear norm; resend re-mints (Resolved Decision 2).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

    // ── Existing-user guards (login resolvability, S2 rule) ─────────
    // Invites are for NEW users; an existing member is edited via users PATCH.
    // Email must be globally unique among tenant users or login (which fails
    // closed on >1 match) breaks for the new user AND the colliding one.
    const existing = await db.query.users.findFirst({
      where: and(eq(users.email, email), eq(users.is_operator, false)),
      columns: { id: true, org_id: true },
    });
    if (existing) {
      return existing.org_id === ctx.effectiveOrgId
        ? error("A member with this email already exists", 409)
        : error("This email is already in use", 409);
    }

    // ── Pending-invite handling: supersede (supports "resend") ──────
    // The partial unique (org_id, email) WHERE accepted_at IS NULL permits one
    // live invite; drop any prior pending row so a fresh token is minted.
    await db
      .delete(invitations)
      .where(
        and(
          eq(invitations.org_id, ctx.effectiveOrgId!),
          eq(invitations.email, email),
          isNull(invitations.accepted_at)
        )
      );

    const { raw, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const [inv] = await db
      .insert(invitations)
      .values({
        org_id: ctx.effectiveOrgId!,
        email,
        client_id: clientIdToSet,
        org_role: orgRoleToSet,
        brand_role: brandRoleToSet,
        token_hash: hash,
        expires_at: expiresAt,
        invited_by: ctx.userId,
      })
      .returning({
        id: invitations.id,
        email: invitations.email,
        expires_at: invitations.expires_at,
      });

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
    const acceptUrl = `${request.nextUrl.origin}/accept-invite?token=${raw}`;

    // Don't surface a send failure as a hard error — the invite row exists and
    // can be resent (mirrors password-reset/request).
    await sendTransactionalEmail(
      email,
      "You've been invited to TalentStream",
      invitationEmail(org?.name ?? "TalentStream", inviterName, acceptUrl)
    );

    return success(inv, 201);
  } catch (err) {
    console.error("POST /api/admin/members/invite error:", err);
    return error("Internal server error", 500);
  }
}
