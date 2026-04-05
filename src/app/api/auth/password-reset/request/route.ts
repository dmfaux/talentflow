import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { generateResetToken } from "@/lib/auth";
import { passwordResetEmail, sendTransactionalEmail } from "@/lib/email";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  // Always return success to prevent email enumeration
  const genericSuccess = NextResponse.json({ success: true });

  if (typeof email !== "string" || !email) {
    return genericSuccess;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user || !user.is_active) {
    return genericSuccess;
  }

  const { raw, hash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.insert(passwordResetTokens).values({
    user_id: user.id,
    token_hash: hash,
    expires_at: expiresAt,
  });

  const origin = request.nextUrl.origin;
  const resetUrl = `${origin}/reset-password/${raw}`;

  await sendTransactionalEmail(
    user.email,
    "Reset your TalentStream password",
    passwordResetEmail(user.first_name, resetUrl)
  );

  return genericSuccess;
}
