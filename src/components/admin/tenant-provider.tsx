"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TenantValue } from "./tenant-shared";

// The client-side view of the tenant context (S8). requireTenant() is server-
// only, so the (admin) layout resolves this once and feeds it to client
// components (sidebar, brand switcher, members, wizard) through this provider —
// a small, serialisable subset of TenantContext plus the caller's accessible
// brands + org name. The SERVER remains the source of truth; this only drives
// cosmetic gating (which nav to show, which brand is active).
//
// The pure pieces (types + canManageOrg) live in tenant-shared.ts so the server
// layout can import them without crossing this client boundary. They are
// re-exported here so client consumers keep importing from one place.
export type { TenantBrand, TenantValue } from "./tenant-shared";
export { canManageOrg } from "./tenant-shared";

const TenantContext = createContext<TenantValue | null>(null);

export function useTenant(): TenantValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return ctx;
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
