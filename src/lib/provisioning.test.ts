import { describe, expect, it } from "vitest";
import {
  isOperatorAuditAction,
  OPERATOR_AUDIT_ACTIONS,
} from "@/lib/operator-audit";
import { validateSlug } from "@/lib/slug";
import { InvitationConflictError } from "@/lib/invitations";

// DB-free unit cores for S9 provisioning. The DB-backed behaviour (the routes,
// transactional org+invite, RBAC) lives in provisioning.itest.ts.

describe("provision_org audit action (S9)", () => {
  it("is in the allow-list", () => {
    expect(OPERATOR_AUDIT_ACTIONS).toContain("provision_org");
  });
  it("isOperatorAuditAction recognises it", () => {
    expect(isOperatorAuditAction("provision_org")).toBe(true);
  });
  it("still rejects unknown actions", () => {
    expect(isOperatorAuditAction("delete_everything")).toBe(false);
    expect(isOperatorAuditAction(42)).toBe(false);
  });
});

describe("org-slug validation (provision input)", () => {
  it("rejects reserved subdomains", () => {
    for (const reserved of ["api", "app", "admin"]) {
      expect(validateSlug(reserved).valid).toBe(false);
    }
  });
  it("rejects malformed slugs", () => {
    expect(validateSlug("Has Spaces").valid).toBe(false);
    expect(validateSlug("UPPER").valid).toBe(false);
    expect(validateSlug("a").valid).toBe(false); // too short
    expect(validateSlug("-leading").valid).toBe(false);
  });
  it("accepts a clean slug", () => {
    expect(validateSlug("acme-holdings").valid).toBe(true);
  });
});

describe("InvitationConflictError", () => {
  it("carries the same-org flag for caller messaging", () => {
    expect(new InvitationConflictError(true).sameOrg).toBe(true);
    expect(new InvitationConflictError(false).sameOrg).toBe(false);
  });
});
