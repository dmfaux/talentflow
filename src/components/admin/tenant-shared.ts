// Pure, environment-neutral tenant types + helpers. This module has NO
// "use client" directive on purpose: it is imported by BOTH the server
// (the (admin) layout, which resolves the tenant context) and the client
// (sidebar, brand switcher, members, wizard, which gate UI cosmetically).
//
// canManageOrg used to live in tenant-provider.tsx, but that file is a client
// module — every export from a "use client" module becomes a client reference,
// so the server layout could not call canManageOrg() directly. Keeping the
// pure helper here lets the server import it without crossing the client
// boundary, while tenant-provider re-exports it for client consumers.

export interface TenantBrand {
  id: string;
  name: string;
}

export interface TenantValue {
  userId: string;
  orgRole: "owner" | "org_admin" | null;
  isOperator: boolean;
  actingOrgId: string | null;
  activeBrandId: string | null;
  orgName: string | null;
  brands: TenantBrand[];
}

/** Org-level reach: owner/org_admin, or an operator acting in an org. Drives the
 *  Brands / Members / Settings nav, the "All brands" switcher entry, and the
 *  invite affordance. UI gating only — every route re-checks server-side. */
export function canManageOrg(t: TenantValue): boolean {
  return (
    t.orgRole === "owner" ||
    t.orgRole === "org_admin" ||
    (t.isOperator && t.actingOrgId !== null)
  );
}
