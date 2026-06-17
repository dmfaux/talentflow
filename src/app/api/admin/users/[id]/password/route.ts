import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { effectiveOrgRole, error, getApiTenant, success } from "@/lib/api";
import { orgScope } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (password.length < 8) return error("Password must be at least 8 characters");
    if (password !== confirmPassword) return error("Passwords do not match");

    // Resolve the target WITHIN the actor's org and as a non-operator. This
    // structurally forbids resetting an operator's password or any other
    // org's user — those resolve to 404 (the account-takeover fix).
    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.id, id),
        orgScope(users, ctx),
        eq(users.is_operator, false)
      ),
      columns: { id: true },
    });
    if (!existing) return error("User not found", 404);

    // Allow an org_admin/owner to reset any same-org member's password, or any
    // user to reset their own. A recruiter/viewer cannot reset a peer's.
    const role = effectiveOrgRole(ctx);
    const isOrgAdmin = role === "owner" || role === "org_admin";
    if (id !== ctx.userId && !isOrgAdmin) return error("Forbidden", 403);

    const passwordHash = await hashPassword(password);

    await db
      .update(users)
      .set({ password_hash: passwordHash, updated_at: new Date() })
      .where(eq(users.id, id));

    // Invalidate any outstanding password reset tokens for this user
    await db
      .update(passwordResetTokens)
      .set({ used_at: new Date() })
      .where(
        and(
          eq(passwordResetTokens.user_id, id),
          isNull(passwordResetTokens.used_at)
        )
      );

    return success({ id });
  } catch (err) {
    console.error("POST /api/admin/users/[id]/password error:", err);
    return error("Internal server error", 500);
  }
}
