import { describe, expect, it } from "vitest";
import { appHostOrigin, classifyHost, isLocalDev, type HostKind } from "@/lib/host";
import { RESERVED_SLUGS } from "@/lib/slug";

// DB-free unit core for S12 host routing. The proxy *behaviour* (rewrites,
// redirects, matcher) lives in src/proxy.test.ts; this pins the pure
// classification matrix that proxy decisions hang off.

const APEX = "talentstream.co.za";

describe("isLocalDev", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3000"])(
    "treats %s as local dev",
    (h) => expect(isLocalDev(h)).toBe(true)
  );
  it.each(["talentstream.co.za", "app.talentstream.co.za", "nedbank.talentstream.co.za"])(
    "treats %s as non-local",
    (h) => expect(isLocalDev(h)).toBe(false)
  );
});

describe("classifyHost", () => {
  const cases: Array<[string, HostKind]> = [
    // Local dev → app, with or without a port (no subdomain needed in dev).
    ["localhost", { kind: "app" }],
    ["localhost:3000", { kind: "app" }],
    ["127.0.0.1:3000", { kind: "app" }],
    // Apex + www → the public marketing face.
    [APEX, { kind: "marketing" }],
    [`www.${APEX}`, { kind: "marketing" }],
    // The dedicated app host.
    [`app.${APEX}`, { kind: "app" }],
    // Brand subdomains → careers, carrying the slug.
    [`nedbank.${APEX}`, { kind: "careers", brandSlug: "nedbank" }],
    [`discovery.${APEX}`, { kind: "careers", brandSlug: "discovery" }],
    // Casing + port are normalised away.
    [`App.TalentStream.co.za:3000`, { kind: "app" }],
    [`NedBank.TalentStream.co.za`, { kind: "careers", brandSlug: "nedbank" }],
    // Multi-level subdomain is not a valid single brand → marketing (safe).
    [`a.b.${APEX}`, { kind: "marketing" }],
    // Foreign / spoofed hosts never become app or a brand.
    ["evil.com", { kind: "marketing" }],
    [`app.evil.com`, { kind: "marketing" }],
    [`nedbank.talentstream.co.za.evil.com`, { kind: "marketing" }],
  ];

  it.each(cases)("classifies %s", (host, expected) => {
    expect(classifyHost(host, APEX)).toEqual(expected);
  });

  it("classifies every reserved subdomain (except app/www) as reserved", () => {
    for (const slug of RESERVED_SLUGS) {
      const got = classifyHost(`${slug}.${APEX}`, APEX);
      if (slug === "app") expect(got).toEqual({ kind: "app" });
      else if (slug === "www") expect(got).toEqual({ kind: "marketing" });
      else expect(got).toEqual({ kind: "reserved" });
    }
  });

  it("never classifies a reserved subdomain as careers", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(classifyHost(`${slug}.${APEX}`, APEX)).not.toMatchObject({
        kind: "careers",
      });
    }
  });

  it("treats everything as app when appDomain is unset (single-host dev)", () => {
    expect(classifyHost(`anything.example.com`, "")).toEqual({ kind: "app" });
    expect(classifyHost(`localhost:3000`, "")).toEqual({ kind: "app" });
  });
});

describe("appHostOrigin", () => {
  it("targets the app. subdomain when a domain is set", () => {
    const prev = process.env.NEXT_PUBLIC_APP_DOMAIN;
    process.env.NEXT_PUBLIC_APP_DOMAIN = APEX;
    expect(appHostOrigin()).toBe(`https://app.${APEX}`);
    process.env.NEXT_PUBLIC_APP_DOMAIN = prev;
  });

  it("falls back to localhost when no domain is set", () => {
    const prev = process.env.NEXT_PUBLIC_APP_DOMAIN;
    delete process.env.NEXT_PUBLIC_APP_DOMAIN;
    expect(appHostOrigin()).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_APP_DOMAIN = prev;
  });
});
