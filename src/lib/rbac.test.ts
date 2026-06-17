import { describe, expect, it } from "vitest";
import {
  ROLE_RANK,
  can,
  decideBrandAccess,
  hasMinRole,
  roleRank,
  type Action,
  type Role,
} from "@/lib/rbac";

// The full RBAC matrix from the S3 spec (§1). This `EXPECTED` table IS the
// security contract — every Action × Role cell is asserted explicitly so a
// silent privilege change shows up as a failing cell, not a quiet regression.
const ROLES: Role[] = [
  "owner",
  "org_admin",
  "brand_admin",
  "recruiter",
  "viewer",
];

const ACTIONS: Action[] = [
  "view",
  "manage_candidate",
  "manage_campaign",
  "publish_campaign",
  "manage_brand",
  "manage_member",
  "manage_org_settings",
  "run_popia_purge",
];

// rows = role, columns = action (same order as ACTIONS above).
const EXPECTED: Record<Role, boolean[]> = {
  //                view  cand   camp  publish brand  member settings purge
  owner: /*    */ [true, true, true, true, true, true, true, true],
  org_admin: /**/ [true, true, true, true, true, true, true, true],
  brand_admin: /**/ [true, true, true, true, false, false, false, false],
  recruiter: /**/ [true, true, true, true, false, false, false, false],
  viewer: /*   */ [true, false, false, false, false, false, false, false],
};

describe("can — the full Action × Role matrix", () => {
  for (const role of ROLES) {
    ACTIONS.forEach((action, col) => {
      const expected = EXPECTED[role][col];
      it(`${role} ${expected ? "CAN" : "cannot"} ${action}`, () => {
        expect(can(action, role)).toBe(expected);
      });
    });
  }

  it("denies every action for a null role", () => {
    for (const action of ACTIONS) {
      expect(can(action, null)).toBe(false);
    }
  });

  it("denies every action for an unknown/legacy role string (fail closed)", () => {
    for (const action of ACTIONS) {
      expect(can(action, "security_group_garbage")).toBe(false);
    }
  });
});

describe("roleRank / hasMinRole ordering", () => {
  it("ranks owner > org_admin > brand_admin > recruiter > viewer", () => {
    expect(roleRank("owner")).toBe(ROLE_RANK.owner);
    expect(roleRank("owner")).toBeGreaterThan(roleRank("org_admin"));
    expect(roleRank("org_admin")).toBeGreaterThan(roleRank("brand_admin"));
    expect(roleRank("brand_admin")).toBeGreaterThan(roleRank("recruiter"));
    expect(roleRank("recruiter")).toBeGreaterThan(roleRank("viewer"));
  });

  it("ranks null / undefined / unknown roles at -1 (below viewer)", () => {
    expect(roleRank(null)).toBe(-1);
    expect(roleRank(undefined)).toBe(-1);
    expect(roleRank("")).toBe(-1);
    expect(roleRank("security_group")).toBe(-1);
    expect(roleRank(null)).toBeLessThan(roleRank("viewer"));
  });

  it("hasMinRole: an owner clears a brand_admin floor; a recruiter does not", () => {
    expect(hasMinRole("owner", "brand_admin")).toBe(true);
    expect(hasMinRole("brand_admin", "brand_admin")).toBe(true);
    expect(hasMinRole("recruiter", "brand_admin")).toBe(false);
    expect(hasMinRole(null, "viewer")).toBe(false);
    expect(hasMinRole("garbage", "viewer")).toBe(false);
  });
});

describe("decideBrandAccess", () => {
  const BRAND = "brand-1";
  const tenant = (orgRole: "owner" | "org_admin" | null) => ({
    orgRole,
    isOperator: false,
    actingOrgId: null,
  });
  const operator = (actingOrgId: string | null) => ({
    orgRole: null,
    isOperator: true,
    actingOrgId,
  });

  it("acting operator → allow (owner-equivalent within the act-as org)", () => {
    expect(decideBrandAccess(operator("org-a"), BRAND, [])).toBe("allow");
  });

  it("non-acting operator → not_found (no blanket bypass, §5.5)", () => {
    expect(decideBrandAccess(operator(null), BRAND, [])).toBe("not_found");
  });

  it("owner → allow without a membership", () => {
    expect(decideBrandAccess(tenant("owner"), BRAND, [])).toBe("allow");
  });

  it("org_admin → allow without a membership", () => {
    expect(decideBrandAccess(tenant("org_admin"), BRAND, [])).toBe("allow");
  });

  it("member with brandRole ≥ minRole → allow", () => {
    const memberships = [{ clientId: BRAND, brandRole: "recruiter" }];
    expect(decideBrandAccess(tenant(null), BRAND, memberships)).toBe("allow");
    expect(
      decideBrandAccess(tenant(null), BRAND, memberships, "recruiter")
    ).toBe("allow");
  });

  it("member with brandRole < minRole → forbidden (resource exists → 403)", () => {
    const memberships = [{ clientId: BRAND, brandRole: "recruiter" }];
    expect(
      decideBrandAccess(tenant(null), BRAND, memberships, "brand_admin")
    ).toBe("forbidden");
  });

  it("non-member recruiter → not_found (denies a recruiter on a non-member brand)", () => {
    const memberships = [{ clientId: "other-brand", brandRole: "recruiter" }];
    expect(decideBrandAccess(tenant(null), BRAND, memberships)).toBe(
      "not_found"
    );
  });

  it("cross-org member (membership on a different brand) → not_found", () => {
    const memberships = [{ clientId: "brand-in-org-b", brandRole: "brand_admin" }];
    expect(decideBrandAccess(tenant(null), BRAND, memberships)).toBe(
      "not_found"
    );
  });

  it("member with an unknown/legacy brandRole and a viewer floor → forbidden (fail closed)", () => {
    const memberships = [{ clientId: BRAND, brandRole: "legacy_role" }];
    expect(decideBrandAccess(tenant(null), BRAND, memberships, "viewer")).toBe(
      "forbidden"
    );
  });
});
