import { db } from "@/db";
import { candidates } from "@/db/schema";
import { generateChatToken, verifyMagicLinkToken } from "@/lib/chat-auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirect = request.nextUrl.searchParams.get("redirect") ?? "/";

  if (!token) {
    return NextResponse.redirect(
      new URL(`${redirect}?error=invalid_link`, request.url)
    );
  }

  const candidateId = await verifyMagicLinkToken(token);

  if (!candidateId) {
    return NextResponse.redirect(
      new URL(`${redirect}?error=invalid_link`, request.url)
    );
  }

  // Generate a new persistent chat token for this candidate
  const newToken = generateChatToken();
  await db
    .update(candidates)
    .set({ chat_token_hash: newToken.hash, updated_at: new Date() })
    .where(eq(candidates.id, candidateId));

  // Redirect to chat page with token in URL fragment (picked up by client JS)
  return NextResponse.redirect(
    new URL(`${redirect}#chat_token=${newToken.raw}`, request.url)
  );
}
