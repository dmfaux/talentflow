import { describe, it, expect } from "vitest";
import {
  DEMO_USERS,
  buildMembershipRows,
  type CastUserWithId,
} from "@/db/seed-cast";

// DB-free unit tests for the S14 seed's membership-grant rules. The rules are
// the lockout/over-grant guardrails the slice warns about, so they get their own
// pure test with zero infrastructure.

const BRAND_IDS = new Map<string, string>([
  ["northwind-bank", "b1"],
  ["northwind-insure", "b2"],
  ["summit-retail", "b3"],
  ["summit-logistics", "b4"],
  ["summit-air", "b5"],
]);

describe("buildMembershipRows", () => {
  it("owners and org_admins receive ZERO memberships (org_role grants all-brand reach)", () => {
    const users: CastUserWithId[] = [
      { id: "u1", email: "owner@x", orgRole: "owner", isOperator: false, memberships: [] },
      { id: "u2", email: "admin@x", orgRole: "org_admin", isOperator: false, memberships: [] },
    ];
    expect(buildMembershipRows(users, BRAND_IDS)).toEqual([]);
  });

  it("operators receive zero memberships", () => {
    const users: CastUserWithId[] = [
      { id: "op", email: "op@x", orgRole: null, isOperator: true, memberships: [] },
    ];
    expect(buildMembershipRows(users, BRAND_IDS)).toEqual([]);
  });

  it("a brand-scoped user receives EXACTLY its declared membership", () => {
    const users: CastUserWithId[] = [
      {
        id: "u3", email: "recruiter@x", orgRole: null, isOperator: false,
        memberships: [{ brandSlug: "northwind-bank", role: "recruiter" }],
      },
    ];
    expect(buildMembershipRows(users, BRAND_IDS)).toEqual([
      { user_id: "u3", client_id: "b1", brand_role: "recruiter" },
    ]);
  });

  it("throws (over-grant) when an org-role user carries a membership", () => {
    const users: CastUserWithId[] = [
      {
        id: "u", email: "owner@x", orgRole: "owner", isOperator: false,
        memberships: [{ brandSlug: "northwind-bank", role: "recruiter" }],
      },
    ];
    expect(() => buildMembershipRows(users, BRAND_IDS)).toThrow(/over-grant/i);
  });

  it("throws (lockout) when a brand-scoped user has no membership", () => {
    const users: CastUserWithId[] = [
      { id: "u", email: "viewer@x", orgRole: null, isOperator: false, memberships: [] },
    ];
    expect(() => buildMembershipRows(users, BRAND_IDS)).toThrow(/lockout/i);
  });

  it("throws on an unknown brand slug", () => {
    const users: CastUserWithId[] = [
      {
        id: "u", email: "v@x", orgRole: null, isOperator: false,
        memberships: [{ brandSlug: "does-not-exist", role: "viewer" }],
      },
    ];
    expect(() => buildMembershipRows(users, BRAND_IDS)).toThrow(/unknown brand/i);
  });

  it("the real DEMO_USERS cast yields one membership per brand-scoped user and none for org roles", () => {
    const tenant: CastUserWithId[] = DEMO_USERS.filter((u) => !u.isOperator).map(
      (u, i) => ({
        id: `u${i}`,
        email: u.email,
        orgRole: u.orgRole,
        isOperator: u.isOperator,
        memberships: u.memberships,
      })
    );
    const rows = buildMembershipRows(tenant, BRAND_IDS);
    // 5 brand-scoped users (2 recruiters, 1 viewer, 2 shared-email rows), each
    // with exactly one membership; the 3 org-role users (2 owners + 1 org_admin)
    // contribute none.
    expect(rows).toHaveLength(5);
    const knownIds = new Set(BRAND_IDS.values());
    expect(rows.every((r) => knownIds.has(r.client_id))).toBe(true);
  });
});
