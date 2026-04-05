import { COOKIE_NAME, signToken, verifyPassword } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const invalidCredentials = NextResponse.json(
    { error: "Invalid email or password" },
    { status: 401 }
  );

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user || !user.is_active) {
    return invalidCredentials;
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    return invalidCredentials;
  }

  const token = await signToken({
    userId: user.id,
    securityGroup: user.security_group,
    clientId: user.client_id,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  return response;
}
