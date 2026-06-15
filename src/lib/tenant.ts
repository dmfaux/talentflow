import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession, type OrgRole, type SessionPayload } from "@/lib/auth";
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

/** S2 = membership check only (identity-layer concern): owner/org_admin pass
 *  implicitly; everyone else must hold a membership on brandId, else 404. There
 *  is deliberately NO minRole parameter yet — S3 adds `minRole` + rbac.can() so
 *  the brand-role comparison lives with the RBAC matrix, not duplicated here.
 *  The signature evolving (adding minRole) is the contract S15 must preserve. */
export async function requireBrandAccess(
  brandId: string
): Promise<TenantContext> {
  const ctx = await requireTenant();
  // Org-level roles span every brand in their org; no per-brand membership
  // is required for them.
  if (ctx.orgRole === "owner" || ctx.orgRole === "org_admin") return ctx;
  const brandMemberships = await getBrandMemberships(ctx.userId);
  if (!brandMemberships.some((m) => m.clientId === brandId)) notFound();
  return ctx;
}
