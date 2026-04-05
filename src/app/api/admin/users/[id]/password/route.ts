import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (password.length < 8) return error("Password must be at least 8 characters");
    if (password !== confirmPassword) return error("Passwords do not match");

    const existing = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true },
    });
    if (!existing) return error("User not found", 404);

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
