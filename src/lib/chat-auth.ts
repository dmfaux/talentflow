import { randomBytes, createHash } from "crypto";
import { db } from "@/db";
import { candidates, chatTokens } from "@/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";

const CHAT_TOKEN_HEADER = "x-chat-token";
const MAGIC_LINK_TTL_MS = 60 * 60 * 1000; // 1 hour (chat re-access link)
/** Recruiter "invite to apply" links live far longer than a chat-access link —
 *  the candidate completes the public form on their own time. */
export const INVITE_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// ── Token generation (mirrors auth.ts pattern) ──────────────────────

export function generateChatToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashChatToken(raw);
  return { raw, hash };
}

export function hashChatToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Persistent token verification ───────────────────────────────────

export async function verifyChatAuth(request: NextRequest) {
  const raw =
    request.headers.get(CHAT_TOKEN_HEADER) ??
    request.nextUrl.searchParams.get("chat_token");

  if (!raw) return null;

  const hash = hashChatToken(raw);

  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.chat_token_hash, hash),
    with: {
      campaign: { with: { client: true } },
    },
  });

  return candidate ?? null;
}

// ── Magic link tokens ───────────────────────────────────────────────

export function generateMagicLinkToken(ttlMs: number = MAGIC_LINK_TTL_MS): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(32).toString("hex");
  const hash = hashChatToken(raw);
  const expiresAt = new Date(Date.now() + ttlMs);
  return { raw, hash, expiresAt };
}

/**
 * Resolve a magic-link / invite token to its candidate id, or null if it is
 * unknown, already consumed, or expired.
 *
 * `consume` (default true) marks the token used on a successful match — correct
 * for one-shot chat-access links. Pass `consume: false` to merely *check* a
 * token without burning it: the recruiter invite-to-apply flow verifies on GET
 * to render the pre-filled form, then consumes only when the candidate actually
 * submits. Consuming on the GET would invalidate the link the moment it opened.
 */
export async function verifyMagicLinkToken(
  raw: string,
  opts: { consume?: boolean } = {}
): Promise<string | null> {
  const consume = opts.consume ?? true;
  const hash = hashChatToken(raw);

  const [token] = await db
    .select({ id: chatTokens.id, candidate_id: chatTokens.candidate_id })
    .from(chatTokens)
    .where(
      and(
        eq(chatTokens.token_hash, hash),
        isNull(chatTokens.used_at),
        gt(chatTokens.expires_at, new Date())
      )
    )
    .limit(1);

  if (!token) return null;

  if (consume) {
    await db
      .update(chatTokens)
      .set({ used_at: new Date() })
      .where(eq(chatTokens.id, token.id));
  }

  return token.candidate_id;
}
