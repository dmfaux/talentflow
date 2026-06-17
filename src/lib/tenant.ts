import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getSession, type OrgRole, type SessionPayload } from "@/lib/auth";
import { decideBrandAccess, type BrandRole } from "@/lib/rbac";
import { db } from "@/db";
import { memberships } from "@/db/schema";

// ── The identity → tenant seam ───────────────────────────────────────
//
// All identity-to-tenant resolution lives here. Nothing in this module reads
// cookies or jose directly — only via getSession(). Swapping to Clerk (S15)
// should touch only auth.ts + this file.

export type BrandMembership = { clientId: string; brandRole: string };

export type TenantContext = {
  userId: string;
  isOperator: boolean;
  orgRole: OrgRole | null;
  orgId: string | null; // the user's home org (null for operators)
  actingOrgId: string | null; // operator act-as target — null until S7
  effectiveOrgId: string | null; // orgId ?? actingOrgId — what S3/S4 scope on
};

/** S7 wires the act-as cookie; returns null in S2. Keeps requireTenant's
 *  operator branch shaped for impersonation without implementing it yet. */
async function getActingOrgId(): Promise<string | null> {
  return null;
}

/** Build the effective TenantContext from a verified session. Single-sourced
 *  so requireTenant (pages) and getApiTenant (route handlers) resolve identity
 *  identically — S7's act-as wiring then has exactly one place to change. */
export async function tenantFromSession(
  session: SessionPayload
): Promise<TenantContext> {
  const actingOrgId = session.isOperator ? await getActingOrgId() : null;
  return {
    userId: session.userId,
    isOperator: session.isOperator,
    orgRole: session.orgRole,
    orgId: session.orgId,
    actingOrgId,
    effectiveOrgId: session.orgId ?? actingOrgId,
  };
}

/** Resolve the effective tenant context, or redirect to /login if no session.
 *  Cached per-request so the layout + child pages share one resolution. */
export const requireTenant = cache(async (): Promise<TenantContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  return tenantFromSession(session);
});

/** Operator-only surfaces (operator console lands in S7). A tenant user hitting
 *  an operator surface gets a 404, not a redirect: don't disclose that the
 *  operator area exists (§5.6) and don't bounce an already-authenticated user
 *  to /login (loop-prone). */
export const requireOperator = cache(async (): Promise<TenantContext> => {
  const ctx = await requireTenant();
  if (!ctx.isOperator) notFound();
  return ctx;
});

/** Brand memberships, resolved on demand (NOT in the JWT, to keep the token
 *  small and avoid stale-membership tokens), memoised per request. */
export const getBrandMemberships = cache(
  async (userId: string): Promise<BrandMembership[]> => {
    const rows = await db.query.memberships.findMany({
      where: eq(memberships.user_id, userId),
      columns: { client_id: true, brand_role: true },
    });
    return rows.map((r) => ({ clientId: r.client_id, brandRole: r.brand_role }));
  }
);

// Org-level role floor. The full hierarchy (owner > org_admin > brand_admin >
// recruiter > viewer) lands in rbac.ts (S3); S2 only needs the org-level rung.
const ORG_ROLE_RANK: Record<OrgRole, number> = { owner: 2, org_admin: 1 };

/** Floor check on org-level role (owner > org_admin). Operators have no org
 *  role, so they do not satisfy an org-role floor — an org-scoped surface is
 *  not theirs (the operator console is the operator surface). Full hierarchy
 *  → rbac.ts (S3). */
export async function requireOrgRole(min: OrgRole): Promise<TenantContext> {
  const ctx = await requireTenant();
  if (!ctx.orgRole || ORG_ROLE_RANK[ctx.orgRole] < ORG_ROLE_RANK[min]) {
    notFound();
  }
  return ctx;
}

/** RSC / server-action brand guard. Resolves ctx, throws on deny, returns the
 *  TenantContext on allow (the S2 contract, preserved). S3 adds the optional
 *  `minRole` — the brand-role comparison itself lives once in rbac.ts
 *  (`decideBrandAccess`), shared with the API surface so the matrix is verified
 *  in one place. The evolving `(brandId, minRole?)` signature is the contract
 *  S15 (Clerk) must preserve.
 *  - not a member / non-acting operator → notFound() (existence hidden, §5.6)
 *  - member but rank < minRole          → notFound() for now (see Open Questions
 *    in the S3 spec: S4 decides whether RSC role-too-low becomes forbidden()). */
export async function requireBrandAccess(
  brandId: string,
  minRole: BrandRole = "viewer"
): Promise<TenantContext> {
  const ctx = await requireTenant();
  // Owner / org_admin / acting-operator are decided without a membership
  // lookup; only a plain tenant member needs the per-brand roles.
  const brandMemberships =
    ctx.orgRole || (ctx.isOperator && ctx.actingOrgId)
      ? []
      : await getBrandMemberships(ctx.userId);
  const decision = decideBrandAccess(ctx, brandId, brandMemberships, minRole);
  if (decision === "not_found") notFound();
  if (decision === "forbidden") notFound(); // ← 404 for now; see S3 Open Questions
  return ctx;
}

/** Boolean brand-access check for RSC control-gating (S5) — mirrors
 *  requireBrandAccess's decision but returns a boolean instead of throwing, so
 *  pages can hide/disable mutation controls a user may not perform. The server
 *  routes remain the source of truth; this is cosmetic. */
export async function canAccessBrand(
  ctx: TenantContext,
  brandId: string,
  minRole: BrandRole = "viewer"
): Promise<boolean> {
  const brandMemberships =
    ctx.orgRole || (ctx.isOperator && ctx.actingOrgId)
      ? []
      : await getBrandMemberships(ctx.userId);
  return decideBrandAccess(ctx, brandId, brandMemberships, minRole) === "allow";
}

// ── Org-scoping primitives (§5.1) ────────────────────────────────────
//
// The reusable enforcement core that S4 (reads) and S5 (writes) call. Pure
// decisions (`isInScope`) are split from the DB-touching/throwing wrappers so
// the unit tests need no Postgres. S3 wires ZERO production routes to these.

/** Tables carrying a denormalised org_id (every guarded leaf). */
type OrgScopedTable = PgTable & { id: AnyPgColumn; org_id: AnyPgColumn };

/** SQL predicate limiting a query to the caller's effective org. Drops straight
 *  into the existing `conditions[]` + `and(...)` route pattern.
 *  - tenant user          → org_id = ctx.orgId        (effectiveOrgId)
 *  - operator, acting      → org_id = ctx.actingOrgId  (effectiveOrgId)
 *  - operator, NOT acting  → FALSE  (no blanket bypass, §5.5)
 *  effectiveOrgId already collapses the three cases.
 *
 *  CRITICAL: when effectiveOrgId is null this MUST be a literal FALSE, never
 *  eq(org_id, null) — Drizzle would emit `org_id = NULL`/bind a null and risk
 *  matching the still-nullable org_id rows. Branch explicitly. */
export function orgScope(table: OrgScopedTable, ctx: TenantContext): SQL {
  return ctx.effectiveOrgId
    ? eq(table.org_id, ctx.effectiveOrgId)
    : sql`false`;
}

/** Pure ownership predicate — the unit-testable core. A non-acting operator
 *  (effectiveOrgId null) owns nothing; a null row org_id never matches. */
export function isInScope(rowOrgId: string | null, ctx: TenantContext): boolean {
  return ctx.effectiveOrgId !== null && rowOrgId === ctx.effectiveOrgId;
}

/** RSC / server-action guard: 404 (not 403) when a row is out of the caller's
 *  scope, to avoid existence disclosure (§5.6). Returns the row for chaining. */
export function assertOwnership<T extends { org_id: string | null }>(
  row: T | null | undefined,
  ctx: TenantContext
): T {
  if (!row || !isInScope(row.org_id, ctx)) notFound();
  return row;
}

/** Fetch a row by id scoped to the caller's org in ONE query — fixes raw-UUID
 *  resolution. A valid cross-org UUID returns null (caller 404s), indistinguishable
 *  from "does not exist". Returns null for a non-acting operator (orgScope → FALSE).
 *  Returns null, not a thrown 404, so it is usable from both route handlers
 *  (return error(...,404)) and RSC pages (if (!row) notFound()). */
export async function resolveOwnedResource<T extends OrgScopedTable>(
  table: T,
  id: string,
  ctx: TenantContext
): Promise<T["$inferSelect"] | null> {
  const [row] = await db
    .select()
    // Cast for the no-columns .from() overload: the generic T can't prove a
    // non-empty selection to Drizzle. The precise per-table return type is
    // preserved by the cast on the returned row below.
    .from(table as PgTable)
    .where(and(eq(table.id, id), orgScope(table, ctx)))
    .limit(1);
  return (row as T["$inferSelect"]) ?? null;
}
