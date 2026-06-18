import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  authorizeApiOrg,
  effectiveOrgRole,
} from "@/lib/api";
import type { TenantContext } from "@/lib/tenant";

// ── Static guard-coverage check (S4 + S5) ────────────────────────────
//
// Mechanically asserts that every admin route handler — READ (GET) and WRITE
// (POST/PATCH/PUT/DELETE) alike — routes its auth through getApiTenant + a
// tenant guard, so a future handler can't silently ship on the
// payload-discarding requireApiAuth. This is the structural half of the
// acceptance gate; the behavioural half is the DB-backed denial matrix
// (*.itest.ts), which only runs when DATABASE_URL is set.
//
// The GET arm is the regression guard for the S4 cross-tenant read leak: an
// UNSCOPED requireApiAuth GET (the dashboard/candidate/applicant breach) fails
// this test because it neither references getApiTenant nor a scoping guard.

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

  const assertSeamAndGuard = (src: string, rel: string, kind: string) => {
    expect(src, `${rel} (${kind}) must call getApiTenant`).toContain(
      "getApiTenant"
    );
    expect(
      GUARDS.some((g) => src.includes(g)),
      `${rel} (${kind}) must use one of ${GUARDS.join("/")}`
    ).toBe(true);
  };

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(Math.max(0, file.indexOf("src/")));
    const hasWrite = WRITE_METHODS.some((m) => exportsFn(src, m));
    const hasGet = exportsFn(src, "GET");

    if (hasWrite) {
      it(`${rel} (write) resolves tenant via getApiTenant + a guard`, () => {
        assertSeamAndGuard(src, rel, "write");
      });
    }

    // S4: the read arm — every admin GET must be org-scoped, not a bare
    // requireApiAuth read. This is what the dashboard/candidate leak tripped on.
    if (hasGet) {
      it(`${rel} (GET) resolves tenant via getApiTenant + a guard`, () => {
        assertSeamAndGuard(src, rel, "GET");
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
