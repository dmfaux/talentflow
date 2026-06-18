import { afterEach, describe, expect, it, vi } from "vitest";

// ── Seam mocks (no DB, no real cookies/JWT) ──────────────────────────
// getActAsClaim reads the act-as cookie and verifies it; getActingOrgId
// (exercised via tenantFromSession) then binds it to the session. We drive both
// by mocking the cookie store + the single JWT verifier, and getSession for the
// requireApiOperator gate. tenantFromSession / getActAsClaim / requireApiOperator
// all run for real.
const cookieHolder = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "operator_act_as" && cookieHolder.token
        ? { value: cookieHolder.token }
        : undefined,
  }),
}));

const verifyHolder = vi.hoisted(() => ({ payload: null as Record<string, unknown> | null }));
vi.mock("@/lib/token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/token")>();
  return { ...actual, verifyJwt: async () => verifyHolder.payload };
});

const sessionHolder = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: async () => sessionHolder.current };
});

// S11: tenantFromSession now does one org-status PK lookup per request for
// non-operators. This is a DB-free seam unit test, so stub getOrgStatus → the
// org is live; OrgInactiveError + the rest of the module stay real. The
// suspended/deleted enforcement itself is covered by the DB-backed itests.
vi.mock("@/lib/org-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/org-status")>();
  return { ...actual, getOrgStatus: async () => "active" as const };
});

import { getActAsClaim, type SessionPayload } from "@/lib/auth";
import { tenantFromSession } from "@/lib/tenant";
import { requireApiOperator } from "@/lib/api";
import { isOperatorAuditAction } from "@/lib/operator-audit";

const operator: SessionPayload = {
  userId: "op-1",
  orgId: null,
  orgRole: null,
  isOperator: true,
};
const tenant: SessionPayload = {
  userId: "u-1",
  orgId: "org-a",
  orgRole: "owner",
  isOperator: false,
};

function setCookie(payload: Record<string, unknown> | null) {
  cookieHolder.token = payload ? "tok" : undefined;
  verifyHolder.payload = payload;
}

afterEach(() => {
  cookieHolder.token = undefined;
  verifyHolder.payload = null;
  sessionHolder.current = null;
});

describe("getActAsClaim", () => {
  it("no cookie → null", async () => {
    setCookie(null);
    expect(await getActAsClaim()).toBeNull();
  });

  it("valid act_as claim → returns operatorUserId + actingOrgId", async () => {
    setCookie({ kind: "act_as", operatorUserId: "op-1", actingOrgId: "org-x" });
    expect(await getActAsClaim()).toEqual({ operatorUserId: "op-1", actingOrgId: "org-x" });
  });

  it("wrong kind → null", async () => {
    setCookie({ kind: "session", operatorUserId: "op-1", actingOrgId: "org-x" });
    expect(await getActAsClaim()).toBeNull();
  });

  it("non-string fields → null", async () => {
    setCookie({ kind: "act_as", operatorUserId: 123, actingOrgId: "org-x" });
    expect(await getActAsClaim()).toBeNull();
  });

  it("expired / malformed token (verifyJwt → null) → null", async () => {
    cookieHolder.token = "tok";
    verifyHolder.payload = null; // verifyJwt returns null on bad signature / expiry
    expect(await getActAsClaim()).toBeNull();
  });
});

describe("getActingOrgId (via tenantFromSession)", () => {
  it("operator + claim bound to the same operator → acts as that org", async () => {
    setCookie({ kind: "act_as", operatorUserId: "op-1", actingOrgId: "org-x" });
    const ctx = await tenantFromSession(operator);
    expect(ctx.actingOrgId).toBe("org-x");
    expect(ctx.effectiveOrgId).toBe("org-x");
  });

  it("operator + claim minted for a DIFFERENT operator → null (theft defeated)", async () => {
    setCookie({ kind: "act_as", operatorUserId: "op-2", actingOrgId: "org-x" });
    const ctx = await tenantFromSession(operator);
    expect(ctx.actingOrgId).toBeNull();
    expect(ctx.effectiveOrgId).toBeNull();
  });

  it("non-operator session + valid claim → ignored (server-side isOperator gate)", async () => {
    setCookie({ kind: "act_as", operatorUserId: "u-1", actingOrgId: "org-x" });
    const ctx = await tenantFromSession(tenant);
    expect(ctx.actingOrgId).toBeNull();
    expect(ctx.effectiveOrgId).toBe("org-a"); // own org, unaffected
  });

  it("operator + no act-as cookie → deny-by-default (null)", async () => {
    setCookie(null);
    const ctx = await tenantFromSession(operator);
    expect(ctx.actingOrgId).toBeNull();
    expect(ctx.effectiveOrgId).toBeNull();
  });
});

describe("requireApiOperator", () => {
  it("operator → ctx, no response", async () => {
    sessionHolder.current = operator;
    const { ctx, response } = await requireApiOperator();
    expect(response).toBeNull();
    expect(ctx?.isOperator).toBe(true);
  });

  it("tenant user → 403", async () => {
    sessionHolder.current = tenant;
    const { ctx, response } = await requireApiOperator();
    expect(ctx).toBeNull();
    expect(response?.status).toBe(403);
  });

  it("unauthenticated → 401", async () => {
    sessionHolder.current = null;
    const { ctx, response } = await requireApiOperator();
    expect(ctx).toBeNull();
    expect(response?.status).toBe(401);
  });
});

describe("operator_audit action allow-list", () => {
  it("recognises the V1 actions", () => {
    for (const a of ["impersonate", "impersonate_exit", "set_tier", "set_billing_email"]) {
      expect(isOperatorAuditAction(a)).toBe(true);
    }
  });

  it("recognises provision_org (added in S9)", () => {
    expect(isOperatorAuditAction("provision_org")).toBe(true);
  });

  it("recognises the S11 lifecycle actions", () => {
    for (const a of ["suspend", "restore", "soft_delete", "purge_org"]) {
      expect(isOperatorAuditAction(a)).toBe(true);
    }
  });

  it("rejects unknown / future-slice actions (until they are added in code)", () => {
    expect(isOperatorAuditAction("purge")).toBe(false); // not the slug — it's purge_org
    expect(isOperatorAuditAction("delete_org")).toBe(false);
    expect(isOperatorAuditAction("")).toBe(false);
    expect(isOperatorAuditAction(42)).toBe(false);
  });
});
