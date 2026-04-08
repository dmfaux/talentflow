import { generateObject, streamText } from "ai";
import { z } from "zod";
import { db } from "@/db";
import { chatMessages, conversations } from "@/db/schema";
import { verifyChatAuth } from "@/lib/chat-auth";
import {
  reactivateConversation,
  updateConversationActivity,
} from "@/lib/chat";
import { buildChatSystemPrompt } from "@/lib/ai/chat-prompt";
import { getChatModel } from "@/lib/ai/chat-provider";
import { eq, and, asc } from "drizzle-orm";
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import type { Topic } from "@/lib/chat";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  // Authenticate candidate via chat token
  const candidate = await verifyChatAuth(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load conversation and verify ownership
  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.candidate_id, candidate.id)
    ),
  });

  if (!conv) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  if (conv.status === "closed") {
    return NextResponse.json(
      { error: "conversation_closed" },
      { status: 403 }
    );
  }

  // Reactivate dormant conversations
  if (conv.status === "dormant") {
    await reactivateConversation(conversationId);
  }

  // Parse the incoming message from the request body
  // TextStreamChatTransport sends UIMessage format with `parts` array
  const body = await request.json();
  const incomingMessages: Array<{
    role: string;
    content?: string;
    parts?: Array<{ type: string; text?: string }>;
  }> = body.messages ?? [];
  const lastUserMessage = incomingMessages[incomingMessages.length - 1];

  if (!lastUserMessage || lastUserMessage.role !== "user") {
    return NextResponse.json(
      { error: "No user message provided" },
      { status: 400 }
    );
  }

  // Extract text from either `content` (legacy) or `parts` (UIMessage v6)
  const userText =
    lastUserMessage.content ??
    lastUserMessage.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("") ??
    "";

  if (!userText.trim()) {
    return NextResponse.json(
      { error: "Empty message" },
      { status: 400 }
    );
  }

  // Save user message to database
  await db.insert(chatMessages).values({
    conversation_id: conversationId,
    role: "user",
    content: userText,
  });

  // Load full message history
  const history = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversation_id, conversationId))
    .orderBy(asc(chatMessages.created_at));

  // Build system prompt with full candidate context
  const campaign = candidate.campaign;
  const client = campaign.client;
  const topics = (conv.topics ?? []) as Topic[];

  const systemPrompt = buildChatSystemPrompt({
    candidateName: candidate.name,
    roleTitle: campaign.role_title,
    roleDescription: campaign.role_description,
    companyName: client?.name ?? "the company",
    location: campaign.location,
    employmentType: campaign.employment_type,
    salaryRangeMin: campaign.salary_range_min,
    salaryRangeMax: campaign.salary_range_max,
    cvText: candidate.cv_text,
    gatingAnswers: candidate.gating_answers as Record<string, string> | null,
    topics,
    lifecycle: conv.lifecycle,
  });

  // Stream response
  const result = streamText({
    model: getChatModel(),
    system: systemPrompt,
    messages: history.map((m) => ({
      role: m.role as "system" | "assistant" | "user",
      content: m.content,
    })),
    maxOutputTokens: 512,
  });

  // Run post-processing after the response is sent — `after()` guarantees
  // execution and proper error visibility, unlike streamText's onFinish
  // which silently swallows all errors via the SDK's internal notify().
  after(async () => {
    try {
      const text = await result.text;
      const reasoningText = await result.reasoningText;

      let cleanText = stripThinking(text);
      if (reasoningText && cleanText.startsWith(reasoningText)) {
        cleanText = cleanText.slice(reasoningText.length).trim();
      }

      // Persist assistant response
      if (cleanText.trim()) {
        await db.insert(chatMessages).values({
          conversation_id: conversationId,
          role: "assistant",
          content: cleanText,
        });
      }

      // Evaluate topic coverage separately — works with any model
      const pendingTopics = topics
        .map((t, i) => ({ index: i, topic: t.topic }))
        .filter((_, i) => !topics[i].covered);

      if (pendingTopics.length > 0) {
        const covered = await evaluateTopicCoverage(
          history,
          cleanText,
          pendingTopics
        );
        if (covered.length > 0) {
          await updateConversationActivity(conversationId, covered);
        }
      }
    } catch (err) {
      console.error("Chat post-processing failed:", err);
    }
  });

  return result.toTextStreamResponse();
}

/**
 * Evaluate which topics have been substantively addressed using a
 * separate focused AI call. Runs after the streamed response is complete
 * so it doesn't affect user-perceived latency.
 */
async function evaluateTopicCoverage(
  history: { role: string; content: string }[],
  latestAssistantMessage: string,
  pendingTopics: { index: number; topic: string }[]
): Promise<number[]> {
  try {
    const transcript = [
      ...history.slice(-10), // last 10 messages for context
      { role: "assistant", content: latestAssistantMessage },
    ]
      .map((m) => `${m.role === "user" ? "CANDIDATE" : "ASSISTANT"}: ${m.content}`)
      .join("\n");

    const { object } = await generateObject({
      model: getChatModel(),
      schema: z.object({
        coveredIndices: z
          .array(z.number())
          .describe(
            "Indices of topics that the candidate has substantively addressed"
          ),
      }),
      prompt: `Review this conversation and determine which of the following topics have been substantively addressed by the candidate (not just acknowledged or asked about).

A topic is substantively addressed when the candidate has provided a **specific** response that includes concrete details such as company names, timeframes, projects, or verifiable context. Generic answers like "I have experience with that" or "I've done that in previous roles" without naming where or when do NOT count as substantively addressed — the assistant should follow up for specifics before the topic is considered covered.

If the assistant has already followed up once asking for specifics and the candidate still gave a generic answer, consider the topic covered (the candidate had their chance).

Topics:
${pendingTopics.map((t) => `${t.index}: ${t.topic}`).join("\n")}

Recent conversation:
${transcript}

Return the indices of topics where the candidate has provided a meaningful, specific response OR where the assistant has already followed up for specifics and the candidate responded (even if still generic). Do NOT include topics that were only asked about but not yet answered, or where the candidate gave a vague first answer and the assistant hasn't yet followed up.`,
    });

    // Filter to only valid pending indices
    const validIndices = new Set(pendingTopics.map((t) => t.index));
    return object.coveredIndices.filter((i) => validIndices.has(i));
  } catch (err) {
    console.error("evaluateTopicCoverage failed:", err);
    return [];
  }
}

/**
 * Strip <think>...</think> blocks from completed text.
 */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
