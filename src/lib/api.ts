import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "./auth";

export function success(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireApiAuth(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    return error("Unauthorized", 401);
  }
  return null;
}
