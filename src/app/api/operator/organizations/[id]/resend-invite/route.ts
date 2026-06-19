import { db } from "@/db";
import { invitations, organizations, users } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import {
  createInvitationRow,
  InvitationConflictError,
  sendInviteEmail,
} from "@/lib/invitations";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/operator/organizations/[id]/resend-invite — re-mint the Owner invite
// (S9 #2). Supersedes the pending org-level Owner invite with a fresh token and
// re-sends. Refuses once the Owner has accepted (409). Body is optional; { email }
// overrides the target. Audited as provision_org with metadata.resend = true.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
      columns: { id: true, name: true },
    });
    if (!org) return error("Organisation not found", 404);

    // Already onboarded → nothing to resend.
    const existingOwner = await db.query.users.findFirst({
      where: and(
        eq(users.org_id, id),
        eq(users.org_role, "owner"),
        eq(users.is_operator, false)
      ),
      columns: { id: true },
    });
    if (existingOwner) {
      return error("The owner has already accepted this invitation", 409);
    }

    const body = await request.json().catch(() => ({}));
    const override =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    // Resolve the target: explicit override, else the pending Owner invite's email.
    const pending = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.org_id, id),
        eq(invitations.org_role, "owner"),
        isNull(invitations.accepted_at)
      ),
      columns: { email: true },
    });
    const email = override || pending?.email || "";
    if (!email) {
      return error("No pending owner invitation to resend", 404);
    }
    if (!EMAIL_RE.test(email)) {
      return error("A valid owner email is required");
    }

    const operator = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { first_name: true, last_name: true },
    });
    const operatorName = operator
      ? `${operator.first_name} ${operator.last_name}`.trim()
      : "";

    // Re-mint via the shared core (supersedes the pending row, fresh token).
    let invitation, rawToken;
    try {
      ({ invitation, rawToken } = await createInvitationRow({
        orgId: id,
        email,
        clientId: null,
        orgRole: "owner",
        brandRole: null,
        invitedBy: ctx.userId,
      }));
    } catch (e) {
      if (e instanceof InvitationConflictError) {
        return error("This email is already in use", 409);
      }
      throw e;
    }

    const acceptUrl = `${request.nextUrl.origin}/accept-invite?token=${rawToken}`;
    await sendInviteEmail(email, org.name, operatorName, acceptUrl);

    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "provision_org",
      targetOrgId: id,
      metadata: { resend: true, owner_email: email },
      ip: clientIp(request),
      endedAt: new Date(),
    });

    return success({ invite: { email, expires_at: invitation.expires_at } });
  } catch (err) {
    console.error(
      "POST /api/operator/organizations/[id]/resend-invite error:",
      err
    );
    return error("Internal server error", 500);
  }
}
