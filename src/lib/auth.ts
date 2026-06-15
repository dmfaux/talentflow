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

export { COOKIE_NAME };
