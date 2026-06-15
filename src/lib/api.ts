import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken, getSession, COOKIE_NAME } from "./auth";
import { tenantFromSession, type TenantContext } from "./tenant";

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

/** Route-handler analog of requireTenant: resolves the effective TenantContext
 *  or returns a 401 response (no redirect). Mirrors the discriminated-union
 *  shape so call sites can `if (response) return response`. The per-route swap
 *  from requireApiAuth → getApiTenant + orgScope is S4/S5, not this slice. */
export async function getApiTenant(): Promise<
  | { ctx: TenantContext; response: null }
  | { ctx: null; response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { ctx: null, response: error("Unauthorized", 401) };
  const ctx = await tenantFromSession(session);
  return { ctx, response: null };
}
