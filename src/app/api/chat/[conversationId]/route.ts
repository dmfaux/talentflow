import { generateObject, streamText } from "ai";
import { z } from "zod";
import { db } from "@/db";
import { chatMessages, conversations } from "@/db/schema";
import { verifyChatAuth } from "@/lib/chat-auth";
import {
  reactivateConversation,
  updateConversationActivity,
  withdrawConversation,
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
        // Check for withdrawal before topic evaluation — if candidate
        // confirmed they want to withdraw, close and skip further processing
        const withdrawn = await detectWithdrawal(history, cleanText);
        if (withdrawn) {
          await withdrawConversation(conversationId);
          return;
        }

        // Only evaluate the first pending topic — this is the one the AI
        // asked about (it always picks the first from the system prompt).
        // Evaluating ALL pending topics at once lets the evaluator mark
        // future topics as "indirectly covered" from rich candidate answers,
        // closing the conversation before those topics are actually asked.
        const covered = await evaluateTopicCoverage(
          history,
          [pendingTopics[0]]
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
  pendingTopics: { index: number; topic: string }[]
): Promise<number[]> {
  try {
    // Only use the last two messages (the assistant's question and the
    // candidate's reply). Using more history lets the evaluator mark
    // topics as "indirectly covered" from earlier answers, closing the
    // conversation before the candidate can answer the current question.
    const transcript = history
      .slice(-2)
      .map((m) => `${m.role === "user" ? "CANDIDATE" : "ASSISTANT"}: ${m.content}`)
      .join("\n");

    const { object } = await generateObject({
      model: getChatModel(),
      schema: z.object({
        coveredIndices: z
          .array(z.number())
          .describe(
            "Indices of topics that the candidate has directly answered"
          ),
      }),
      prompt: `Review this exchange and determine whether the candidate has directly answered the topic below.

A topic is covered ONLY when the candidate has directly responded to a question about it in their latest message.

A topic is NOT covered if:
- The candidate mentioned related information while answering a DIFFERENT question earlier
- The candidate's latest message doesn't address this topic
- The topic was only asked about but not answered yet

Topic:
${pendingTopics.map((t) => `${t.index}: ${t.topic}`).join("\n")}

Latest exchange:
${transcript}

Return the index ONLY if the candidate's latest message directly answers this topic.`,
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
 * Detect whether the candidate has confirmed they want to withdraw from the
 * process. Only triggers on an explicit confirmation — not on vague
 * frustration or requests to pause.
 */
async function detectWithdrawal(
  history: { role: string; content: string }[],
  latestAssistantMessage: string
): Promise<boolean> {
  try {
    const transcript = [
      ...history.slice(-6),
      { role: "assistant", content: latestAssistantMessage },
    ]
      .map(
        (m) =>
          `${m.role === "user" ? "CANDIDATE" : "ASSISTANT"}: ${m.content}`
      )
      .join("\n");

    const { object } = await generateObject({
      model: getChatModel(),
      schema: z.object({
        withdrawn: z
          .boolean()
          .describe(
            "True ONLY if the candidate has explicitly confirmed they want to withdraw from the recruitment process"
          ),
      }),
      prompt: `Review this conversation excerpt and determine whether the candidate has explicitly confirmed they want to withdraw from the recruitment process.

Return true ONLY if the candidate clearly and unambiguously stated they want to withdraw, quit, or be removed from consideration. This means:
- The assistant asked them to confirm withdrawal AND the candidate confirmed (e.g. "yes, please withdraw me", "I'd like to withdraw")
- OR the candidate proactively and clearly stated they want to withdraw (e.g. "I want to withdraw my application")

Return false if:
- The candidate only said they want to stop chatting, take a break, or come back later
- The candidate expressed frustration but didn't explicitly withdraw
- The assistant asked about withdrawal but the candidate hasn't responded yet or said they'd continue

Recent conversation:
${transcript}`,
    });

    return object.withdrawn;
  } catch (err) {
    console.error("detectWithdrawal failed:", err);
    return false;
  }
}

/**
 * Strip <think>...</think> blocks from completed text.
 */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
