import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  getRedirectUrl,
  getRewrittenUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { SignJWT } from "jose";
import { config, proxy } from "@/proxy";

// S12 proxy behaviour, asserted without a browser via Next's proxy test harness
// (proxy.md "Unit testing"). The DB-free classification matrix lives in
// src/lib/host.test.ts; this pins the rewrite / redirect / auth decisions the
// proxy makes per host class.

const APEX = "talentstream.co.za";
const SECRET = "test-proxy-secret-please-ignore-0123456789";

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_DOMAIN = APEX;
  process.env.ADMIN_AUTH_SECRET = SECRET;
});

function req(
  url: string,
  { host, cookie }: { host: string; cookie?: string }
): NextRequest {
  const headers: Record<string, string> = { host };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { headers });
}

async function signSession(): Promise<string> {
  return new SignJWT({
    userId: "u1",
    orgId: "o1",
    orgRole: "owner",
    isOperator: false,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(SECRET));
}

describe("careers subdomain", () => {
  it("pins the brand: every path is rewritten under /c/{brand}", async () => {
    const res = await proxy(
      req(`https://nedbank.${APEX}/role`, { host: `nedbank.${APEX}` })
    );
    expect(isRewrite(res)).toBe(true);
    expect(new URL(getRewrittenUrl(res)!).pathname).toBe("/c/nedbank/role");
  });

  it("rewrites the careers root to the brand landing /c/{brand}", async () => {
    const res = await proxy(
      req(`https://nedbank.${APEX}/`, { host: `nedbank.${APEX}` })
    );
    expect(new URL(getRewrittenUrl(res)!).pathname).toBe("/c/nedbank");
  });

  it("cannot reach another brand by path (→ a non-route under /c/{brand})", async () => {
    const res = await proxy(
      req(`https://nedbank.${APEX}/c/discovery/role`, { host: `nedbank.${APEX}` })
    );
    // /c/discovery/role on the nedbank host becomes /c/nedbank/c/discovery/role,
    // which has no matching route and 404s — no cross-brand data crosses.
    expect(new URL(getRewrittenUrl(res)!).pathname).toBe(
      "/c/nedbank/c/discovery/role"
    );
  });

  it("admin/operator paths on a careers host 404 (rewritten under /c/{brand})", async () => {
    for (const p of ["/dashboard", "/operator", "/clients"]) {
      const res = await proxy(
        req(`https://nedbank.${APEX}${p}`, { host: `nedbank.${APEX}` })
      );
      expect(new URL(getRewrittenUrl(res)!).pathname).toBe(`/c/nedbank${p}`);
    }
  });

  it("does NOT rewrite /api on a careers host, but tags the host brand", async () => {
    const res = await proxy(
      req(`https://nedbank.${APEX}/api/apply/nedbank/role`, {
        host: `nedbank.${APEX}`,
      })
    );
    expect(isRewrite(res)).toBe(false);
    expect(res.headers.get("x-middleware-request-x-careers-brand")).toBe(
      "nedbank"
    );
  });
});

describe("reserved subdomain", () => {
  it("serves marketing (never /c/{reserved})", async () => {
    const res = await proxy(
      req(`https://api.${APEX}/anything`, { host: `api.${APEX}` })
    );
    expect(new URL(getRewrittenUrl(res)!).pathname).toBe("/");
  });
});

describe("marketing host (apex / www)", () => {
  it("serves the landing at / untouched", async () => {
    const res = await proxy(req(`https://${APEX}/`, { host: APEX }));
    expect(isRewrite(res)).toBe(false);
    expect(getRedirectUrl(res)).toBeNull();
  });

  it("bounces an app-only path to the app-host login carrying ?from", async () => {
    const res = await proxy(req(`https://${APEX}/dashboard`, { host: APEX }));
    const loc = new URL(getRedirectUrl(res)!);
    expect(loc.host).toBe(`app.${APEX}`);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("from")).toBe("/dashboard");
  });

  it("bounces /operator from www to the app host too", async () => {
    const res = await proxy(
      req(`https://www.${APEX}/operator`, { host: `www.${APEX}` })
    );
    const loc = new URL(getRedirectUrl(res)!);
    expect(loc.host).toBe(`app.${APEX}`);
    expect(loc.searchParams.get("from")).toBe("/operator");
  });
});

describe("app host", () => {
  it("redirects an unauthenticated app path to /login?from=", async () => {
    const res = await proxy(
      req(`https://app.${APEX}/dashboard`, { host: `app.${APEX}` })
    );
    const loc = new URL(getRedirectUrl(res)!);
    expect(loc.host).toBe(`app.${APEX}`);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("from")).toBe("/dashboard");
  });

  it("lets an authenticated app path through", async () => {
    const token = await signSession();
    const res = await proxy(
      req(`https://app.${APEX}/dashboard`, {
        host: `app.${APEX}`,
        cookie: `admin_session=${token}`,
      })
    );
    expect(getRedirectUrl(res)).toBeNull();
    expect(isRewrite(res)).toBe(false);
  });

  it("treats a tampered cookie as unauthenticated", async () => {
    const res = await proxy(
      req(`https://app.${APEX}/dashboard`, {
        host: `app.${APEX}`,
        cookie: `admin_session=not-a-real-jwt`,
      })
    );
    expect(new URL(getRedirectUrl(res)!).pathname).toBe("/login");
  });

  it("leaves the public login / reset / accept-invite / legal pages alone", async () => {
    for (const p of [
      "/",
      "/login",
      "/reset-password",
      "/accept-invite/abc",
      "/privacy",
      "/popia",
      "/terms",
    ]) {
      const res = await proxy(req(`https://app.${APEX}${p}`, { host: `app.${APEX}` }));
      expect(getRedirectUrl(res)).toBeNull();
      expect(isRewrite(res)).toBe(false);
    }
  });

  it("keeps /c/* public on the app host (Decision B)", async () => {
    const res = await proxy(
      req(`https://app.${APEX}/c/nedbank/role`, { host: `app.${APEX}` })
    );
    expect(getRedirectUrl(res)).toBeNull();
    expect(isRewrite(res)).toBe(false);
  });
});

describe("localhost (single-host dev)", () => {
  it("serves the login page without a subdomain", async () => {
    const res = await proxy(
      req(`http://localhost:3000/login`, { host: "localhost:3000" })
    );
    expect(getRedirectUrl(res)).toBeNull();
    expect(isRewrite(res)).toBe(false);
  });

  it("serves careers by path", async () => {
    const res = await proxy(
      req(`http://localhost:3000/c/nedbank/role`, { host: "localhost:3000" })
    );
    expect(isRewrite(res)).toBe(false);
  });

  it("still protects an app path with no session", async () => {
    const res = await proxy(
      req(`http://localhost:3000/dashboard`, { host: "localhost:3000" })
    );
    expect(new URL(getRedirectUrl(res)!).pathname).toBe("/login");
  });
});

describe("config.matcher", () => {
  it("runs on app routes", () => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/dashboard" })
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/c/nedbank/role" })
    ).toBe(true);
  });

  it("skips /_next and dotted static assets", () => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/_next/static/chunk.js" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/logo.png" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/favicon.ico" })
    ).toBe(false);
  });
});
