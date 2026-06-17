import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken, getSession, COOKIE_NAME, type OrgRole } from "./auth";
import {
  getBrandMemberships,
  tenantFromSession,
  type TenantContext,
} from "./tenant";
import {
  can,
  decideBrandAccess,
  type Action,
  type BrandRole,
} from "./rbac";

export function success(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireApiAuth(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    return error("Unauthorized", 401);
  }
  return null;
}

/** Route-handler analog of requireTenant: resolves the effective TenantContext
 *  or returns a 401 response (no redirect). Mirrors the discriminated-union
 *  shape so call sites can `if (response) return response`. The per-route swap
 *  from requireApiAuth → getApiTenant + orgScope is S4/S5, not this slice. */
export async function getApiTenant(): Promise<
  | { ctx: TenantContext; response: null }
  | { ctx: null; response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { ctx: null, response: error("Unauthorized", 401) };
  const ctx = await tenantFromSession(session);
  return { ctx, response: null };
}

// ── API-surface RBAC gates (S5) ──────────────────────────────────────
//
// The route-handler analogs of the RSC `requireBrandAccess`: they RETURN a
// NextResponse (or null) rather than throwing notFound()/redirect(). They
// reuse the S3 pure cores (`can`/`decideBrandAccess`/`getBrandMemberships`)
// verbatim so the role matrix stays verified in one place. Kept here, not in
// tenant.ts, to avoid a next/server import in the RSC-shared module.

/** Effective org-level role for RBAC. An acting operator is owner-equivalent
 *  within the acted org (dormant until S7); otherwise the user's own org_role
 *  (null for plain brand members). */
export function effectiveOrgRole(ctx: TenantContext): OrgRole | null {
  if (ctx.isOperator && ctx.actingOrgId) return "owner";
  return ctx.orgRole;
}

/** Org-level RBAC gate (manage_brand / manage_member / manage_org_settings /
 *  run_popia_purge). Returns a 403 response or null (allowed). The org
 *  boundary itself is enforced separately by orgScope/resolveOwnedResource. */
export function authorizeApiOrg(
  ctx: TenantContext,
  action: Action
): NextResponse | null {
  return can(action, effectiveOrgRole(ctx)) ? null : error("Forbidden", 403);
}

/** Brand-level RBAC gate (manage_candidate / manage_campaign / publish_campaign).
 *  404 for a non-member brand (existence hidden), 403 for member-but-too-low,
 *  null for allowed. The resource is normally already org-scoped via
 *  resolveOwnedResource, so the only 404 path here is a same-org non-member brand. */
export async function authorizeApiBrand(
  ctx: TenantContext,
  brandId: string,
  minRole: BrandRole = "viewer"
): Promise<NextResponse | null> {
  // Owner / org_admin / acting-operator are decided without a membership
  // lookup; only a plain tenant member needs the per-brand roles.
  const memberships = effectiveOrgRole(ctx)
    ? []
    : await getBrandMemberships(ctx.userId);
  const decision = decideBrandAccess(ctx, brandId, memberships, minRole);
  if (decision === "not_found") return error("Not found", 404);
  if (decision === "forbidden") return error("Forbidden", 403);
  return null;
}
