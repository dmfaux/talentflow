import type { OrgRole } from "@/lib/auth";

// ── RBAC: the pure role matrix (no I/O) ──────────────────────────────
//
// The single source of truth for "what may this role do". Pure functions
// only — no db, no next/*, no react — so the matrix is unit-testable with
// zero infrastructure. This is the security-critical core; tests come first.
// Per-route application (calling `can`/`requireBrandAccess`) lands in S4/S5.

export type BrandRole = "brand_admin" | "recruiter" | "viewer";

/** The unified, linearly-ordered role scale (plan §6: owner > org_admin >
 *  brand_admin > recruiter > viewer). Org roles and brand roles share one
 *  ranking so an owner outranks any brand-level minimum. */
export type Role = OrgRole | BrandRole;

export const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  org_admin: 3,
  brand_admin: 2,
  recruiter: 1,
  viewer: 0,
};

/** Unknown / malformed role strings (brand_role is free-text in the DB) rank
 *  below everything → fail closed. Never throws. */
export function roleRank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : -1;
}

export function hasMinRole(role: string | null, min: Role): boolean {
  return roleRank(role) >= ROLE_RANK[min];
}

/** The actions every mutating/read surface gates on. Starter set derived from
 *  S5's acceptance; S5 may add actions (each is just an action→min-role entry). */
export type Action =
  | "view" // any member
  | "manage_candidate" // candidate PATCH, open-chat (recruiter+)
  | "manage_campaign" // campaign create/edit/archive/delete (recruiter+)
  | "publish_campaign" // status → active (recruiter+; viewer excluded)
  | "manage_brand" // clients POST/PATCH/logo (org_admin+)
  | "manage_member" // users / memberships (org_admin+)
  | "manage_org_settings" // org profile (org_admin+; tier stays operator-only)
  | "run_popia_purge" // tenant POPIA purge/deletion (org_admin+)
  | "view_spend"; // usage & spend view + spend-alert subscription (org_admin+)

const ACTION_MIN_ROLE: Record<Action, Role> = {
  view: "viewer",
  manage_candidate: "recruiter",
  manage_campaign: "recruiter",
  publish_campaign: "recruiter",
  manage_brand: "org_admin",
  manage_member: "org_admin",
  manage_org_settings: "org_admin",
  run_popia_purge: "org_admin",
  view_spend: "org_admin",
};

/** May `role` perform `action`? Linear-rank model, faithful to the plan's
 *  strict hierarchy. `null`/unknown role → always false. */
export function can(action: Action, role: string | null): boolean {
  return roleRank(role) >= ROLE_RANK[ACTION_MIN_ROLE[action]];
}

// ── Pure brand-access decision ───────────────────────────────────────

export type AccessDecision = "allow" | "forbidden" | "not_found";

/** Pure brand-access decision (§5.5/§5.6 aware) — the role logic behind
 *  `requireBrandAccess`, factored out so it is unit-testable without a DB.
 *  `requireBrandAccess` (in tenant.ts) is a thin wrapper that fetches
 *  memberships and translates the decision into the right interrupt/response.
 *  - acting operator                  → allow (owner-equivalent within the act-as org)
 *  - owner / org_admin                → allow (span every brand in their org)
 *  - member of brand, rank ≥ minRole  → allow
 *  - member of brand, rank <  minRole → forbidden (resource exists for them → 403)
 *  - not a member (incl. non-acting operator) → not_found (don't disclose existence → 404)
 */
export function decideBrandAccess(
  actor: { orgRole: OrgRole | null; isOperator: boolean; actingOrgId: string | null },
  brandId: string,
  memberships: { clientId: string; brandRole: string }[],
  minRole: BrandRole = "viewer"
): AccessDecision {
  if (actor.isOperator && actor.actingOrgId) return "allow"; // dormant until S7
  if (actor.orgRole === "owner" || actor.orgRole === "org_admin") return "allow";
  const m = memberships.find((x) => x.clientId === brandId);
  if (!m) return "not_found";
  return hasMinRole(m.brandRole, minRole) ? "allow" : "forbidden";
}
