import { jwtVerify, type JWTPayload } from "jose";

// ── Edge-safe token verification (the single verifier) ───────────────
//
// This is the ONLY place that calls `jwtVerify`. It depends on `jose` +
// the secret and NOTHING else — no `next/headers`, no `db`, no bcrypt —
// so it can be imported by edge proxy (proxy.ts) without dragging Node-only
// code into the edge bundle. Both proxy.ts and auth.ts verify through here.

export function getAuthSecret(): Uint8Array {
  const secret = process.env.ADMIN_AUTH_SECRET;
  if (!secret) throw new Error("ADMIN_AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

/** Verify signature + expiry. Returns the decoded payload, or null if invalid. */
export async function verifyJwt(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    return payload;
  } catch {
    return null;
  }
}
