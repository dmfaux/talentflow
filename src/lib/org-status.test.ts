import { beforeEach, describe, expect, it, vi } from "vitest";

// DB-free unit test for the S11 org-status primitive. getOrgStatus does one PK
// lookup, so we mock @/db; everything else (isOrgStatus, the OrgInactiveError
// mapping) is pure.
vi.mock("@/db", () => ({
  db: { query: { organizations: { findFirst: vi.fn() } } },
}));

import { db } from "@/db";
import {
  getOrgStatus,
  isOrgStatus,
  orgInactiveFrom,
  OrgInactiveError,
  ORG_STATUSES,
} from "@/lib/org-status";

const findFirst = db.query.organizations.findFirst as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => findFirst.mockReset());

describe("isOrgStatus", () => {
  it("accepts the three lifecycle states", () => {
    for (const s of ORG_STATUSES) expect(isOrgStatus(s)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isOrgStatus("archived")).toBe(false);
    expect(isOrgStatus("")).toBe(false);
    expect(isOrgStatus(42)).toBe(false);
    expect(isOrgStatus(null)).toBe(false);
  });
});

describe("getOrgStatus", () => {
  it("returns the status for a live org", async () => {
    findFirst.mockResolvedValue({ status: "suspended" });
    expect(await getOrgStatus("org-1")).toBe("suspended");
  });

  it("maps a missing row (hard-purged) → null", async () => {
    findFirst.mockResolvedValue(undefined);
    expect(await getOrgStatus("gone")).toBeNull();
  });

  it("maps an unrecognised status → null (fail closed)", async () => {
    findFirst.mockResolvedValue({ status: "weird" });
    expect(await getOrgStatus("org-2")).toBeNull();
  });
});

describe("OrgInactiveError → HTTP", () => {
  it("suspended → 403", () => {
    const e = new OrgInactiveError("suspended");
    expect(e.status).toBe("suspended");
    expect(e.httpStatus).toBe(403);
    expect(e).toBeInstanceOf(Error);
  });

  it("deleted → 401", () => {
    expect(new OrgInactiveError("deleted").httpStatus).toBe(401);
  });
});

describe("orgInactiveFrom", () => {
  it("suspended stays suspended (403)", () => {
    expect(orgInactiveFrom("suspended").httpStatus).toBe(403);
  });
  it("deleted → deleted (401)", () => {
    expect(orgInactiveFrom("deleted").status).toBe("deleted");
  });
  it("null (purged) coerces to deleted (401)", () => {
    const e = orgInactiveFrom(null);
    expect(e.status).toBe("deleted");
    expect(e.httpStatus).toBe(401);
  });
});
