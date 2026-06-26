import { NextRequest, NextResponse } from "next/server";
import { appHostOrigin, classifyHost } from "@/lib/host";
import { verifyJwt } from "@/lib/token";

const COOKIE_NAME = "admin_session";

// Public on the APP host — reachable without a session: the marketing/login
// landing, the login gateway, password-reset, the invite-accept page the
// invitee opens before they have any session (S8), and the public legal pages
// (privacy, POPIA, terms) linked from the footer.
function isPublicAppPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/reset-password/") ||
    pathname === "/accept-invite" ||
    pathname.startsWith("/accept-invite/") ||
    pathname === "/privacy" ||
    pathname === "/popia" ||
    pathname === "/terms"
  );
}

// App / operator / auth surfaces that must live on the app host. Hitting one on
// the marketing host (apex/www) bounces to the app-host login, so admin and the
// operator console are reachable ONLY on the app host (acceptance). Kept small
// and constant — a foreign path on the marketing host just 404s as usual.
const APP_ONLY_PREFIXES = [
  "/login",
  "/dashboard",
  "/operator",
  "/campaigns",
  "/candidates",
  "/clients",
  "/users",
  "/settings",
  "/reset-password",
  "/accept-invite",
];
function isAppOnlyPath(pathname: string): boolean {
  return APP_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = classifyHost(
    request.headers.get("host") ?? "",
    process.env.NEXT_PUBLIC_APP_DOMAIN ?? ""
  );

  // ── /api + Next internals: NEVER subdomain-rewrite an API path ──────
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    // Defence-in-depth (Decision C): tag careers-host API calls with the host
    // brand so a handler may assert the path slug matches the host. NOT a gate —
    // the canonical org_id is still resolved from the path slug downstream.
    if (host.kind === "careers") {
      const headers = new Headers(request.headers);
      headers.set("x-careers-brand", host.brandSlug);
      return NextResponse.next({ request: { headers } });
    }
    return NextResponse.next();
  }

  switch (host.kind) {
    case "careers": {
      // Pin the brand from the host. Everything is served under /c/{brand}, so
      // another brand cannot be reached by path: nedbank.{domain}/c/other →
      // /c/nedbank/c/other, a non-route → 404. The slug is the boundary
      // (clients.slug is globally unique → exactly one org). org.status refusal
      // stays in the handlers (S11) — the proxy must never read the DB.
      const url = request.nextUrl.clone();
      url.pathname = `/c/${host.brandSlug}${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(url);
    }

    case "reserved":
      // A reserved subdomain (api., admin., mail., …) never resolves to a brand.
      // Serve the marketing landing rather than erroring (Decision D) — friendly
      // and doesn't disclose which subdomains are special.
      return NextResponse.rewrite(new URL("/", request.url));

    case "marketing":
      // Apex / www: the public landing only. App/operator/auth surfaces belong
      // on the app host → bounce to its login, carrying the intended path.
      if (isAppOnlyPath(pathname)) {
        return NextResponse.redirect(
          new URL(
            `/login?from=${encodeURIComponent(pathname)}`,
            appHostOrigin()
          )
        );
      }
      return NextResponse.next();

    case "app": {
      // The authenticated app host (+ localhost). Careers-by-path stays public
      // here (Decision B) so existing /c/* links — worker chat invitations, the
      // request-access magic link — keep working unchanged.
      if (isPublicAppPath(pathname) || pathname.startsWith("/c/")) {
        return NextResponse.next();
      }
      // Optimistic signature check only; the canonical tenant/operator guard is
      // requireTenant()/requireOperator() in the layouts. The proxy must not read
      // the DB (see Next.js Proxy docs).
      const token = request.cookies.get(COOKIE_NAME)?.value;
      if (!token || (await verifyJwt(token)) === null) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("from", pathname);
        return NextResponse.redirect(loginUrl);
      }
      return NextResponse.next();
    }
  }
}

export const config = {
  matcher: [
    /*
     * Run proxy on all routes except:
     * - /_next (Next.js internals)
     * - Static files with extensions
     * (/api is matched but handled with an early return inside the proxy.)
     */
    "/((?!_next/|.*\\.).*)",
  ],
};
