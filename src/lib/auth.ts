import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSecret, verifyJwt } from "./token";

const COOKIE_NAME = "admin_session";
const TOKEN_EXPIRY = "8h";
const BCRYPT_WORK_FACTOR = 12;

export type OrgRole = "owner" | "org_admin";

export type SessionPayload = {
  userId: string;
  orgId: string | null; // null ⇒ operator
  orgRole: OrgRole | null; // null for operators and non-org_role members
  isOperator: boolean;
};

export async function signToken(payload: SessionPayload): Promise<string> {
  // Signing only ever runs server-side (login), never in edge proxy, so
  // SignJWT lives here rather than in the edge-safe token.ts.
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getAuthSecret());
}

export async function verifyToken(token: string): Promise<boolean> {
  return (await verifyJwt(token)) !== null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyJwt(token);
  if (!payload) return null;

  // Parse the new claim shape. Operators carry orgId/orgRole NULL, so those
  // are validated as `string | null` rather than the old exact-3-string reject.
  if (
    typeof payload.userId !== "string" ||
    typeof payload.isOperator !== "boolean"
  ) {
    return null;
  }
  const orgId = payload.orgId;
  const orgRole = payload.orgRole;
  if (orgId !== null && typeof orgId !== "string") return null;
  if (orgRole !== null && orgRole !== "owner" && orgRole !== "org_admin") {
    return null;
  }

  return {
    userId: payload.userId,
    orgId,
    orgRole,
    isOperator: payload.isOperator,
  };
}

export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

// ── Operator act-as cookie (S7) ──────────────────────────────────────
//
// Impersonation rides a SEPARATE, short-lived signed-JWT cookie — never baked
// into the long-lived admin_session (the slice forbids it). Reuses
// ADMIN_AUTH_SECRET, so it is tamper-proof with no new secret; the JWT TTL *is*
// the time-box (Resolved Decision 6) — when it lapses verifyJwt returns null and
// the operator silently drops back to deny-by-default. Read only inside the seam
// (auth.ts/tenant.ts), like admin_session. The operatorUserId is cross-checked
// against the session in tenant.ts so a stolen/replayed cookie minted for
// another operator is rejected.

const ACT_AS_COOKIE = "operator_act_as";
const ACT_AS_EXPIRY = "60m"; // fixed time-box, no sliding renewal (Resolved Decision 6)
export const ACT_AS_MAX_AGE = 60 * 60; // seconds; mirrors ACT_AS_EXPIRY for the cookie

export async function signActAsToken(
  operatorUserId: string,
  actingOrgId: string
): Promise<string> {
  return new SignJWT({ operatorUserId, actingOrgId, kind: "act_as" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACT_AS_EXPIRY)
    .sign(getAuthSecret());
}

export async function getActAsClaim(): Promise<{
  operatorUserId: string;
  actingOrgId: string;
} | null> {
  const token = (await cookies()).get(ACT_AS_COOKIE)?.value;
  if (!token) return null;
  const p = await verifyJwt(token); // signature + expiry; null if expired → auto-exit when TTL lapses
  if (!p || p.kind !== "act_as") return null;
  if (typeof p.operatorUserId !== "string" || typeof p.actingOrgId !== "string") {
    return null;
  }
  return { operatorUserId: p.operatorUserId, actingOrgId: p.actingOrgId };
}

// ── Active-brand cookie (S8) ─────────────────────────────────────────
//
// The BrandSwitcher's selection. Unlike the act-as cookie (which IS a privilege
// grant, hence signed), active_brand grants NOTHING — it only narrows reads
// within the user's already-enforced access, so a plain unsigned cookie is fine.
// The security is the per-request membership re-check in tenantFromSession
// (canAccessBrand): a tampered/foreign value coerces to null, never an error on
// a read path. Read only inside the seam (auth.ts/tenant.ts), like admin_session.

const ACTIVE_BRAND_COOKIE = "active_brand";
export const ACTIVE_BRAND_MAX_AGE = 60 * 60 * 8; // seconds; mirrors the session

export async function getActiveBrandCookie(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_BRAND_COOKIE)?.value ?? null;
}

// ── Password hashing ─────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_WORK_FACTOR);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Password reset tokens ────────────────────────────────────────────

export function generateResetToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashResetToken(raw);
  return { raw, hash };
}

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export { COOKIE_NAME, ACT_AS_COOKIE, ACTIVE_BRAND_COOKIE };

// Invite tokens reuse the hardened reset-token primitive verbatim (sha256,
// single-use, TTL) — aliased so call sites read intentfully (S8).
export { generateResetToken as generateInviteToken };
