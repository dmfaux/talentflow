import { randomBytes, createHash } from "crypto";
import { db } from "@/db";
import { candidates, chatTokens } from "@/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";

const CHAT_TOKEN_HEADER = "x-chat-token";
const MAGIC_LINK_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export function generateMagicLinkToken(): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(32).toString("hex");
  const hash = hashChatToken(raw);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  return { raw, hash, expiresAt };
}

export async function verifyMagicLinkToken(
  raw: string
): Promise<string | null> {
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

  // Mark as used
  await db
    .update(chatTokens)
    .set({ used_at: new Date() })
    .where(eq(chatTokens.id, token.id));

  return token.candidate_id;
}
