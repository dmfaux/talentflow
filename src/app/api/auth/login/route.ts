import { COOKIE_NAME, signToken, verifyPassword, type OrgRole } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

  // Resolve by email WITHOUT .limit(1). Under per-org email uniqueness the V1
  // convention is "globally-unique tenant email" (operators are globally unique
  // by index), but that is an application convention, not a DB constraint — so
  // fail CLOSED if it is ever violated: select login-eligible (active) users
  // and reject a collision (>1 match) with the generic 401 rather than silently
  // picking one row. Write-time enforcement of the convention is S5/S8.
  const matches = await db
    .select()
    .from(users)
    .where(and(eq(users.email, normalizedEmail), eq(users.is_active, true)));

  if (matches.length !== 1) {
    return invalidCredentials;
  }
  const user = matches[0];

  if (!(await verifyPassword(password, user.password_hash))) {
    return invalidCredentials;
  }

  const token = await signToken({
    userId: user.id,
    orgId: user.org_id, // null for operators
    orgRole: user.org_role as OrgRole | null,
    isOperator: user.is_operator,
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
