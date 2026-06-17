"use client";

import { createContext, useContext, type ReactNode } from "react";

// The client-side view of the tenant context (S8). requireTenant() is server-
// only, so the (admin) layout resolves this once and feeds it to client
// components (sidebar, brand switcher, members, wizard) through this provider —
// a small, serialisable subset of TenantContext plus the caller's accessible
// brands + org name. The SERVER remains the source of truth; this only drives
// cosmetic gating (which nav to show, which brand is active).

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

const TenantContext = createContext<TenantValue | null>(null);

export function useTenant(): TenantValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return ctx;
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

export function TenantProvider({
  value,
  children,
}: {
  value: TenantValue;
  children: ReactNode;
}) {
  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}
