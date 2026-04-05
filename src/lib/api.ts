import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken, getSession, COOKIE_NAME, SessionPayload } from "./auth";

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

export async function getApiSession(): Promise<
  { session: SessionPayload; response: null } | { session: null; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { session: null, response: error("Unauthorized", 401) };
  }
  return { session, response: null };
}
