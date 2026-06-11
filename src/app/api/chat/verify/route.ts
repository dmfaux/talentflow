import { db } from "@/db";
import { candidates } from "@/db/schema";
import { generateChatToken, verifyMagicLinkToken } from "@/lib/chat-auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirect = request.nextUrl.searchParams.get("redirect") ?? "/";

  // Resolve the redirect target as a URL so an existing query string (e.g. the
  // ?t=<conversationId> request-access carries for the fallback flow) survives
  // when we attach our own param/fragment, instead of forming a malformed
  // double-"?".
  const target = new URL(redirect, request.url);

  const candidateId = token ? await verifyMagicLinkToken(token) : null;

  if (!candidateId) {
    target.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(target);
  }

  // Generate a new persistent chat token for this candidate
  const newToken = generateChatToken();
  await db
    .update(candidates)
    .set({ chat_token_hash: newToken.hash, updated_at: new Date() })
    .where(eq(candidates.id, candidateId));

  // Hand the token to the client via the URL fragment (picked up by client JS)
  target.hash = `chat_token=${newToken.raw}`;
  return NextResponse.redirect(target);
}
