import { generateObject, streamText } from "ai";
import { z } from "zod";
import { db } from "@/db";
import { chatMessages, conversations } from "@/db/schema";
import { verifyChatAuth } from "@/lib/chat-auth";
import {
  reactivateConversation,
  recordTopicProgress,
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
  let topics = (conv.topics ?? []) as Topic[];

  const firstPendingTopic = topics
    .map((topic, index) => ({ ...topic, index }))
    .find((topic) => !topic.covered);

  // Decide coverage now so this response's prompt reflects it, but persist
  // it only in after() — once withdrawal has been ruled out and the
  // assistant reply is saved, so the re-score reads a complete transcript
  // and a withdrawal can never be converted into a completed conversation.
  let coveredIndex: number | undefined;
  if (
    firstPendingTopic &&
    shouldMarkTopicCovered(history, userText, firstPendingTopic)
  ) {
    coveredIndex = firstPendingTopic.index;
    topics = topics.map((topic, index) =>
      index === coveredIndex
        ? { ...topic, covered: true, asked: false }
        : topic
    );
  }

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

      const withdrawn = await detectWithdrawal(history, cleanText);
      if (withdrawn) {
        await withdrawConversation(conversationId);
        return;
      }

      // The topic the assistant should have just raised is the first one
      // still pending after this message's coverage. Only flag it as asked
      // when the reply actually poses a question — an answer to a side
      // question must not arm the topic for coverage.
      const nextPendingIndex = topics.findIndex((t) => !t.covered);
      const askedIndex =
        nextPendingIndex !== -1 &&
        cleanText.trim() &&
        looksLikeTopicQuestion(cleanText)
          ? nextPendingIndex
          : undefined;

      await recordTopicProgress(conversationId, { coveredIndex, askedIndex });
    } catch (err) {
      console.error("Chat post-processing failed:", err);
    }
  });

  return result.toTextStreamResponse();
}

function shouldMarkTopicCovered(
  history: { role: string; content: string }[],
  userText: string,
  topic: Topic & { index: number }
): boolean {
  if (isExplicitWithdrawalRequest(userText)) return false;
  if (isQuestionOnly(userText)) return false;
  if (isStallOrAcknowledgement(userText)) return false;
  if (topic.asked) return true;

  const previousAssistant = [...history]
    .reverse()
    .find((message) => message.role === "assistant");

  if (!previousAssistant) return false;

  return looksLikeTopicQuestion(previousAssistant.content);
}

function isExplicitWithdrawalRequest(text: string): boolean {
  return /\b(withdraw|withdrawn|remove me from consideration|no longer want to (continue|proceed)|not interested in (continuing|proceeding))\b/i.test(
    text
  );
}

function isQuestionOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("?")) return false;

  // A leading acknowledgement doesn't make a message an answer — "Sure,
  // can you clarify if that's monthly?" is still a question. Strip the
  // interjection and classify what follows.
  const withoutAck = trimmed.replace(
    /^(yes|yeah|yep|no|nope|sure|ok(?:ay)?|correct|that's right|that is right)\b[,.!\s]*/i,
    ""
  );
  if (
    !/^(what|when|where|why|who|which|how|can|could|would|will|is|are|do|does|did|should|shall)\b/i.test(
      withoutAck
    )
  ) {
    return false;
  }

  // Substantial content after the question mark means the message is an
  // answer that happens to open with a question ("Would R45k work? I
  // currently earn R40k and have 6 years experience"), not question-only.
  const afterQuestion = trimmed.slice(trimmed.indexOf("?") + 1).trim();
  if (afterQuestion.split(/\s+/).filter(Boolean).length >= 5) return false;

  return true;
}

/**
 * Pure stall/acknowledgement messages carry no answer content and must not
 * cover a topic. Bare affirmations ("yes", "no", "sure") are deliberately
 * NOT treated as stalls — topics are often posed as yes/no questions and a
 * bare affirmative is a real answer.
 */
function isStallOrAcknowledgement(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^(thanks?|thank you|great|cool|nice|got it|sounds good|good to know|no problem|alright|noted|hm+|mm+|uh+|brb)[.!,\s]*$/i.test(
      trimmed
    ) ||
    /^(ok(?:ay)?[,.!\s]+)?(one|just a|gimme a|give me a)\s+(sec(?:ond)?|minute|moment|bit)\b/i.test(
      trimmed
    ) ||
    /^(hold on|hang on|wait|let me (?:think|check|get back))\b/i.test(trimmed) ||
    /^(sorry[,.!\s]+)?(i (?:don'?t|do not) understand|what do you mean|i'?m not sure what)/i.test(
      trimmed
    )
  );
}

function looksLikeTopicQuestion(text: string): boolean {
  if (/let me know when (you're|you are) ready/i.test(text)) return false;
  if (text.includes("?")) return true;

  return /\b(confirm|clarify|could you|can you|would you|are you|do you)\b/i.test(text);
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
