import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invitations, users } from "@/db/schema";
import { generateInviteToken, type OrgRole } from "@/lib/auth";
import { invitationEmail, sendTransactionalEmail } from "@/lib/email";

// ── Shared invitation core (S8/S9) ───────────────────────────────────
//
// The single verified path for minting an invitation row, shared by the tenant
// member-invite route (POST /api/admin/members/invite — S8) and operator
// provisioning (POST /api/operator/organizations — S9). Both need the SAME
// global-email guard + pending-supersede, and provisioning needs the org+invite
// insert to be transactional (no orphan org), so row-creation is separable from
// the best-effort, post-commit email send.

// Colleague-actioned async, so the 1h reset-token TTL is far too short. 7 days
// matches the GitHub/Slack/Linear norm; a resend re-mints (supersede below).
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A db handle OR an open transaction — both expose the same query/insert/delete
// surface, so createInvitationRow can run standalone or inside db.transaction.
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown by createInvitationRow when the email already belongs to a tenant user
 *  (login resolvability, S2 rule — login fails closed on >1 match). `sameOrg`
 *  lets the caller pick its message (a same-org "member exists" vs a cross-org
 *  generic "in use"). Inside a transaction this rolls the whole unit back. */
export class InvitationConflictError extends Error {
  constructor(public readonly sameOrg: boolean) {
    super("email_in_use");
    this.name = "InvitationConflictError";
  }
}

export interface CreateInvitationOptions {
  orgId: string;
  /** Caller must pre-normalise (trim + lowercase) to match users + login. */
  email: string;
  /** null for an ORG-LEVEL invite (Owner/Org-Admin); set for a brand invite. */
  clientId: string | null;
  orgRole: OrgRole | null;
  brandRole: string | null;
  invitedBy: string | null;
}

export interface CreatedInvitation {
  invitation: { id: string; email: string; expires_at: Date };
  rawToken: string;
}

/** Mint a fresh invitation row (the verified core). Enforces the global-email
 *  guard, supersedes any pending invite for (orgId, email), inserts a new
 *  sha256-hashed single-use token with a 7-day TTL, and returns the row + the
 *  raw token (the secret is never persisted, only its hash). Accepts an optional
 *  executor so provisioning can run it inside a transaction with the org insert. */
export async function createInvitationRow(
  opts: CreateInvitationOptions,
  exec: Executor = db
): Promise<CreatedInvitation> {
  // ── Global-email guard (login resolvability, S2 rule) ───────────────
  // Invites are for NEW users; an existing member is edited via users PATCH.
  // Email must be globally unique among tenant users or login (fails closed on
  // >1 match) breaks for the new user AND the colliding one.
  const existing = await exec.query.users.findFirst({
    where: and(eq(users.email, opts.email), eq(users.is_operator, false)),
    columns: { id: true, org_id: true },
  });
  if (existing) {
    throw new InvitationConflictError(existing.org_id === opts.orgId);
  }

  // ── Pending-invite supersede (supports "resend") ────────────────────
  // The partial unique (org_id, email) WHERE accepted_at IS NULL permits one
  // live invite; drop any prior pending row so a fresh token is minted.
  await exec
    .delete(invitations)
    .where(
      and(
        eq(invitations.org_id, opts.orgId),
        eq(invitations.email, opts.email),
        isNull(invitations.accepted_at)
      )
    );

  const { raw, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const [invitation] = await exec
    .insert(invitations)
    .values({
      org_id: opts.orgId,
      email: opts.email,
      client_id: opts.clientId,
      org_role: opts.orgRole,
      brand_role: opts.brandRole,
      token_hash: hash,
      expires_at: expiresAt,
      invited_by: opts.invitedBy,
    })
    .returning({
      id: invitations.id,
      email: invitations.email,
      expires_at: invitations.expires_at,
    });

  return { invitation, rawToken: raw };
}

/** Best-effort transactional invite email (mirrors password-reset: row first,
 *  mail best-effort). Never throws — the invite row exists and is resendable, so
 *  a send failure must not fail the request. orgName/inviterName are HTML-escaped
 *  inside invitationEmail. */
export async function sendInviteEmail(
  email: string,
  orgName: string,
  inviterName: string,
  acceptUrl: string
): Promise<void> {
  await sendTransactionalEmail(
    email,
    "You've been invited to TalentStream",
    invitationEmail(orgName || "TalentStream", inviterName, acceptUrl)
  );
}
