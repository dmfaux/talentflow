import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { isInScope, orgScope, type TenantContext } from "@/lib/tenant";
import { candidates } from "@/db/schema";

const dialect = new PgDialect();

// Pure-core tests for the org-scoping primitives. No DB: `isInScope` is pure,
// and `orgScope` only builds a SQL fragment (it never runs a query). The
// DB-touching wrappers (`resolveOwnedResource`/`assertOwnership`) are covered
// behaviourally in S4 against two seeded orgs — documented in the S3 spec's
// Test Plan as a hand-off so S4 doesn't assume S3 covered them.

const ctx = (
  over: Partial<TenantContext> & { effectiveOrgId: string | null }
): TenantContext => ({
  userId: "u1",
  isOperator: false,
  orgRole: null,
  orgId: over.effectiveOrgId,
  actingOrgId: null,
  ...over,
});

const tenant = ctx({ effectiveOrgId: "org-a", orgId: "org-a" });
const crossOrgRow = "org-b";
const nonActingOperator = ctx({
  isOperator: true,
  orgId: null,
  effectiveOrgId: null,
});
const actingOperator = ctx({
  isOperator: true,
  orgId: null,
  actingOrgId: "org-a",
  effectiveOrgId: "org-a",
});

describe("isInScope", () => {
  it("tenant row in own org → true", () => {
    expect(isInScope("org-a", tenant)).toBe(true);
  });

  it("tenant row in another org → false", () => {
    expect(isInScope(crossOrgRow, tenant)).toBe(false);
  });

  it("non-acting operator (effectiveOrgId null) owns nothing → false", () => {
    expect(isInScope("org-a", nonActingOperator)).toBe(false);
    expect(isInScope("org-b", nonActingOperator)).toBe(false);
  });

  it("acting operator scoped to its act-as org → true", () => {
    expect(isInScope("org-a", actingOperator)).toBe(true);
    expect(isInScope("org-b", actingOperator)).toBe(false);
  });

  it("row with null org_id never matches — even for a null-scoped caller", () => {
    expect(isInScope(null, tenant)).toBe(false);
    expect(isInScope(null, nonActingOperator)).toBe(false);
  });
});

describe("orgScope", () => {
  it("tenant ctx → an eq(org_id, …) predicate, NOT the false sentinel", () => {
    const { sql, params } = dialect.sqlToQuery(orgScope(candidates, tenant));
    // A real column comparison binds the org id; the false sentinel does not.
    // Inspecting the serialized SQL keeps this assertion light while the
    // behavioural guarantee is fully covered by isInScope above.
    expect(params).toContain("org-a");
    expect(sql).toContain("org_id");
  });

  it("non-acting operator ctx → the literal FALSE sentinel (no blanket bypass)", () => {
    const { sql, params } = dialect.sqlToQuery(
      orgScope(candidates, nonActingOperator)
    );
    // Must be a bare FALSE — never eq(org_id, NULL), which would risk matching
    // the still-nullable org_id rows (§5.5). No bound params, sql is `false`.
    expect(sql.toLowerCase()).toBe("false");
    expect(params).toHaveLength(0);
  });
});
