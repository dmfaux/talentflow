import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  authorizeApiOrg,
  effectiveOrgRole,
} from "@/lib/api";
import type { TenantContext } from "@/lib/tenant";

// ── Static guard-coverage check (S5) ─────────────────────────────────
//
// Mechanically asserts that every mutating admin route handler routes its auth
// through getApiTenant + a tenant guard, so a future write route can't silently
// ship on the payload-discarding requireApiAuth. This is the structural half of
// the acceptance gate; the behavioural half is the DB-backed write-denial
// matrix (*.itest.ts), which only runs when DATABASE_URL is set.
//
// Sequencing: S4 (read conversions) has NOT landed at this commit, so
// mixed-method files still call requireApiAuth for their GET. The "no
// requireApiAuth" assertion therefore applies only to WRITE-ONLY routes (which
// S5 fully converted); once S4 converts the GETs it can widen to every route.

const ADMIN_API_DIR = join(process.cwd(), "src/app/api/admin");
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"] as const;

// An org-boundary guard or RBAC gate. orgScope counts because users/[id]/password
// resolves its target through `orgScope` before an effectiveOrgRole role check.
const GUARDS = [
  "authorizeApiOrg",
  "authorizeApiBrand",
  "resolveOwnedResource",
  "orgScope",
] as const;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function exportsFn(src: string, name: string): boolean {
  return new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(src);
}

describe("guard coverage: mutating admin routes", () => {
  const files = routeFiles(ADMIN_API_DIR);

  it("discovers admin route files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(Math.max(0, file.indexOf("src/")));
    if (!WRITE_METHODS.some((m) => exportsFn(src, m))) continue;

    it(`${rel} resolves tenant via getApiTenant + a guard`, () => {
      expect(src, `${rel} must call getApiTenant`).toContain("getApiTenant");
      expect(
        GUARDS.some((g) => src.includes(g)),
        `${rel} must use one of ${GUARDS.join("/")}`
      ).toBe(true);
    });

    if (!exportsFn(src, "GET")) {
      it(`${rel} (write-only) drops requireApiAuth`, () => {
        expect(
          src.includes("requireApiAuth"),
          `${rel} is write-only and must not use requireApiAuth`
        ).toBe(false);
      });
    }
  }
});

// ── Pure-logic coverage for the new API gates ────────────────────────
//
// The role matrix itself is exhaustively tested in rbac.test.ts; these only
// confirm the thin api.ts wrappers translate a TenantContext correctly. Only
// the DB-free branches are exercised here (the membership-fetch branch of
// authorizeApiBrand is covered behaviourally in the itest matrix).

const ctx = (over: Partial<TenantContext>): TenantContext => ({
  userId: "u1",
  isOperator: false,
  orgRole: null,
  orgId: "org-a",
  actingOrgId: null,
  effectiveOrgId: "org-a",
  activeBrandId: null,
  ...over,
});

describe("effectiveOrgRole", () => {
  it("acting operator → owner-equivalent", () => {
    expect(
      effectiveOrgRole(
        ctx({ isOperator: true, orgId: null, actingOrgId: "org-a", orgRole: null })
      )
    ).toBe("owner");
  });

  it("non-acting operator → null (writes nothing)", () => {
    expect(
      effectiveOrgRole(
        ctx({ isOperator: true, orgId: null, effectiveOrgId: null, orgRole: null })
      )
    ).toBeNull();
  });

  it("tenant owner / org_admin → their own role", () => {
    expect(effectiveOrgRole(ctx({ orgRole: "owner" }))).toBe("owner");
    expect(effectiveOrgRole(ctx({ orgRole: "org_admin" }))).toBe("org_admin");
  });

  it("plain brand member → null", () => {
    expect(effectiveOrgRole(ctx({ orgRole: null }))).toBeNull();
  });
});

describe("authorizeApiOrg", () => {
  it("owner / org_admin allowed → null", () => {
    expect(authorizeApiOrg(ctx({ orgRole: "owner" }), "manage_member")).toBeNull();
    expect(authorizeApiOrg(ctx({ orgRole: "org_admin" }), "manage_brand")).toBeNull();
  });

  it("plain member or non-acting operator → 403", () => {
    expect(
      authorizeApiOrg(ctx({ orgRole: null }), "manage_member")?.status
    ).toBe(403);
    expect(
      authorizeApiOrg(
        ctx({ isOperator: true, orgId: null, effectiveOrgId: null }),
        "run_popia_purge"
      )?.status
    ).toBe(403);
  });
});
