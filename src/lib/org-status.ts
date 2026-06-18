import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";

// ── Org lifecycle status (S11) ───────────────────────────────────────
//
// `organizations.status` is free-text in the schema (no CHECK constraint),
// validated against this in-code allow-list — mirroring how `tier` is handled
// (Resolved Decision B). Centralised here so the seam, login/invite, public
// careers, the operator routes, and the worker all share ONE definition of
// "is this org live". No migration: the columns + cascade FKs already exist.

export const ORG_STATUSES = ["active", "suspended", "deleted"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export function isOrgStatus(value: unknown): value is OrgStatus {
  return (
    typeof value === "string" &&
    (ORG_STATUSES as readonly string[]).includes(value)
  );
}

/** Cheap PK lookup of an org's lifecycle status. Returns null when the row is
 *  gone (hard-purged) — callers treat null as "deleted/gone". Used by the seam
 *  (one lookup per request, behind the React cache() wrapper), login/invite,
 *  the public surfaces, and the queue gate. */
export async function getOrgStatus(orgId: string): Promise<OrgStatus | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { status: true },
  });
  if (!org) return null;
  return isOrgStatus(org.status) ? org.status : null;
}

/** Thrown by the identity→tenant seam (tenantFromSession) when a non-operator's
 *  effective org is not `active`. requireTenant (RSC) maps it to a /login
 *  redirect; getApiTenant (route handlers) maps it to a 403 (suspended) / 401
 *  (deleted) response. A typed error so both wrappers branch cleanly without a
 *  next/server or next/navigation import leaking into this RSC-shared module. */
export class OrgInactiveError extends Error {
  /** The blocking status: "suspended" or "deleted" (a purged/null org is
   *  reported as "deleted"). */
  readonly status: Exclude<OrgStatus, "active">;

  constructor(status: Exclude<OrgStatus, "active">) {
    super(`Organization is ${status}`);
    this.name = "OrgInactiveError";
    this.status = status;
  }

  /** HTTP status for the route-handler surface: suspended → 403, deleted → 401. */
  get httpStatus(): number {
    return this.status === "suspended" ? 403 : 401;
  }
}

/** Map a non-active status (or a null/purged org) to the OrgInactiveError shape.
 *  Centralises the "null → deleted" coercion used across the seam + login. */
export function orgInactiveFrom(status: OrgStatus | null): OrgInactiveError {
  return new OrgInactiveError(status === "suspended" ? "suspended" : "deleted");
}
