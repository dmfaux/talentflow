import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/token";

const COOKIE_NAME = "admin_session";
const PUBLIC_ADMIN_PATHS = ["/", "/login"];

function isLocalDev(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.startsWith("localhost:") ||
    hostname.startsWith("127.0.0.1")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip internals, API, and static assets
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const hostname = request.headers.get("host") ?? "";
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "";

  // ── Subdomain rewriting (production only) ──────────────────────
  if (!isLocalDev(hostname) && appDomain) {
    // Extract subdomain: "nedbank.talentstream.co.za" → "nedbank"
    const subdomain = hostname.replace(`.${appDomain}`, "").replace(appDomain, "");

    if (subdomain && subdomain !== "www") {
      // Rewrite to /c/[subdomain] transparently
      const url = request.nextUrl.clone();
      url.pathname = `/c/${subdomain}${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  // ── Admin auth (no subdomain / www / localhost) ────────────────

  // Allow candidate routes and public paths through without auth
  if (pathname.startsWith("/c/")) {
    return NextResponse.next();
  }

  if (PUBLIC_ADMIN_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  // Password reset flow is public (includes token subpaths)
  if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) {
    return NextResponse.next();
  }

  // Invite-accept page is public — the invitee has no session yet (S8). The
  // accept API (/api/auth/invite/accept) is already exempt via the /api/ guard.
  if (pathname === "/accept-invite" || pathname.startsWith("/accept-invite/")) {
    return NextResponse.next();
  }

  // Protect admin routes. This is an optimistic signature check only; the
  // canonical tenant guard is requireTenant() in (admin)/layout.tsx — the
  // proxy must not read the DB (see Next.js Proxy docs).
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || (await verifyJwt(token)) === null) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run proxy on all routes except:
     * - /_next (Next.js internals)
     * - /api (handled inside proxy with early return)
     * - Static files with extensions
     */
    "/((?!_next/|.*\\.).*)",
  ],
};
