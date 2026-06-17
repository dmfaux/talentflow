import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { brandScope, type TenantContext } from "@/lib/tenant";
import { campaigns } from "@/db/schema";
import { invitationEmail } from "@/lib/email";

const dialect = new PgDialect();

// Pure-core tests for the S8 brand-narrowing predicate + invite email template.
// No DB: brandScope only builds a SQL fragment; invitationEmail is a pure
// string template. The DB-backed behaviour (validation, accept) is covered in
// invitations.itest.ts.

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

describe("brandScope", () => {
  it("active brand → eq(client_id, brand)", () => {
    const sql = brandScope(campaigns, ctx({ activeBrandId: "brand-a" }));
    expect(sql).toBeDefined();
    const { sql: text, params } = dialect.sqlToQuery(sql!);
    expect(text).toContain("client_id");
    expect(params).toContain("brand-a");
  });

  it("no active brand → undefined (drops out of the conditions list)", () => {
    expect(brandScope(campaigns, ctx({ activeBrandId: null }))).toBeUndefined();
  });
});

describe("invitationEmail", () => {
  it("renders the accept URL (button + fallback link)", () => {
    const url = "https://app.test/accept-invite?token=abc123";
    const html = invitationEmail("Acme Corp", "Dana Scully", url);
    expect(html).toContain(url);
    expect(html).toContain("Acme Corp");
    expect(html).toContain("Dana Scully");
  });

  it("escapes org/inviter free text (no raw HTML injection)", () => {
    const html = invitationEmail("<script>x</script>", "A & B", "https://x.test");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });

  it("omits the inviter clause when no inviter name", () => {
    const html = invitationEmail("Acme", "", "https://x.test");
    expect(html).toContain("Acme");
    expect(html).toContain("invited to join");
  });
});
