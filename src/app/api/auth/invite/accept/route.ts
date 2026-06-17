import { db } from "@/db";
import { invitations, memberships, users } from "@/db/schema";
import {
  COOKIE_NAME,
  hashPassword,
  hashResetToken,
  signToken,
  type OrgRole,
} from "@/lib/auth";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// Legacy security_group is NOT NULL until S13 and gates nothing — write the
// fixed default so creation works without exposing it (mirrors users POST).
const LEGACY_SECURITY_GROUP = "user";

// PUBLIC: the invitee has no session yet. This is a SECOND login surface — it
// signs the same admin_session as login/route.ts. Token validation mirrors
// password-reset/confirm (sha256 hash, single-use via accepted_at, TTL).
export async function POST(request: NextRequest) {
  const { token, firstName, lastName, password } = await request.json();

  if (
    typeof token !== "string" ||
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof password !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const first = firstName.trim();
  const last = lastName.trim();
  if (!first) return NextResponse.json({ error: "First name is required" }, { status: 400 });
  if (!last) return NextResponse.json({ error: "Last name is required" }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const tokenHash = hashResetToken(token);
  const [inv] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token_hash, tokenHash),
        isNull(invitations.accepted_at),
        gt(invitations.expires_at, new Date())
      )
    )
    .limit(1);

  if (!inv) {
    return NextResponse.json(
      { error: "This invitation is invalid or has expired" },
      { status: 400 }
    );
  }

  // Re-check global email uniqueness at accept time (not just create): the email
  // may have self-registered elsewhere since the invite was sent. A collision
  // would break login resolvability (login fails closed on >1 match), so refuse.
  const collision = await db.query.users.findFirst({
    where: and(eq(users.email, inv.email), eq(users.is_operator, false)),
    columns: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      { error: "An account with this email already exists. Please sign in." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);

  // User + membership + token burn as one unit: two writes and a single-use
  // token burn must not half-apply.
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        org_id: inv.org_id,
        client_id: inv.client_id ?? null, // brand invite → brand; org invite → null
        org_role: inv.org_role,
        is_operator: false,
        first_name: first,
        last_name: last,
        email: inv.email,
        password_hash: passwordHash,
        security_group: LEGACY_SECURITY_GROUP,
      })
      .returning({ id: users.id });

    if (inv.client_id && inv.brand_role) {
      await tx
        .insert(memberships)
        .values({
          user_id: user.id,
          client_id: inv.client_id,
          brand_role: inv.brand_role,
        })
        .onConflictDoUpdate({
          target: [memberships.user_id, memberships.client_id],
          set: { brand_role: inv.brand_role, updated_at: new Date() },
        });
    }

    await tx
      .update(invitations)
      .set({ accepted_at: new Date(), updated_at: new Date() })
      .where(eq(invitations.id, inv.id));

    return user.id;
  });

  // The invitee is now logged in — sign the identical session/cookie as login.
  const sessionToken = await signToken({
    userId,
    orgId: inv.org_id,
    orgRole: (inv.org_role as OrgRole | null) ?? null,
    isOperator: false,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours — mirrors login
  });
  return response;
}
