import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { hashPassword, hashResetToken } from "@/lib/auth";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { token, password, confirmPassword } = await request.json();

  if (
    typeof token !== "string" ||
    typeof password !== "string" ||
    typeof confirmPassword !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: "Passwords do not match" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const tokenHash = hashResetToken(token);
  const now = new Date();

  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.token_hash, tokenHash),
        isNull(passwordResetTokens.used_at),
        gt(passwordResetTokens.expires_at, now)
      )
    )
    .limit(1);

  if (!record) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);

  await db
    .update(users)
    .set({ password_hash: passwordHash, updated_at: new Date() })
    .where(eq(users.id, record.user_id));

  // Mark this token used
  await db
    .update(passwordResetTokens)
    .set({ used_at: new Date() })
    .where(eq(passwordResetTokens.id, record.id));

  // Invalidate all other outstanding tokens for this user
  await db
    .update(passwordResetTokens)
    .set({ used_at: new Date() })
    .where(
      and(
        eq(passwordResetTokens.user_id, record.user_id),
        isNull(passwordResetTokens.used_at)
      )
    );

  return NextResponse.json({ success: true });
}
