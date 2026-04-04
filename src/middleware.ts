import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_session";

const PUBLIC_ADMIN_PATHS = ["/login"];

function getSecret() {
  const secret = process.env.ADMIN_AUTH_SECRET;
  if (!secret) throw new Error("ADMIN_AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

async function isValidToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect admin routes (those not in public list)
  if (PUBLIC_ADMIN_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token || !(await isValidToken(token))) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match admin routes only. Excludes:
     * - /api (API routes)
     * - /_next (Next.js internals)
     * - /login (public admin page)
     * - static files
     * - candidate routes (everything not matched here)
     *
     * The (admin) group resolves to the root, so admin pages
     * sit at /dashboard, /campaigns, etc. We list them explicitly
     * as the app grows, or use a prefix convention.
     *
     * For now: protect /dashboard and everything under it.
     */
    "/dashboard/:path*",
  ],
};
