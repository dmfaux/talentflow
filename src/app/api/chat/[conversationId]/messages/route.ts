import { db } from "@/db";
import { chatMessages, conversations } from "@/db/schema";
import { verifyChatAuth } from "@/lib/chat-auth";
import { eq, and, gt, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  const candidate = await verifyChatAuth(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify conversation ownership
  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.candidate_id, candidate.id)
    ),
    columns: { status: true },
  });

  if (!conv) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const since = request.nextUrl.searchParams.get("since");
  const sinceDate = since ? new Date(since) : new Date(0);

  const msgs = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      created_at: chatMessages.created_at,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversation_id, conversationId),
        gt(chatMessages.created_at, sinceDate)
      )
    )
    .orderBy(asc(chatMessages.created_at));

  return NextResponse.json({
    messages: msgs,
    status: conv.status,
  });
}
