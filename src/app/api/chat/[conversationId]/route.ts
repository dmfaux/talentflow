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
import {
  recordConsentConfirmed,
  RECRUITER_MANUAL_SOURCE,
} from "@/lib/manual-candidate";
import { buildChatSystemPrompt } from "@/lib/ai/chat-prompt";
import { getChatModel, getChatModelMeta } from "@/lib/ai/chat-provider";
import { extractUsage, type TokenUsage } from "@/lib/ai";
import { recordUsageEvent } from "@/lib/usage";
import { getOrgStatus } from "@/lib/org-status";
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

  // Refuse a suspended/deleted org's chat (S11) — the public path skips the
  // seam, so this handler gates on the resolved org: 503 (suspended) / 410
  // (deleted/gone).
  const orgStatus = await getOrgStatus(conv.org_id);
  if (orgStatus !== "active") {
    return NextResponse.json(
      { error: orgStatus === "suspended" ? "chat_unavailable" : "chat_closed" },
      { status: orgStatus === "suspended" ? 503 : 410 }
    );
  }

  if (conv.status === "closed") {
    return NextResponse.json(
      { error: "conversation_closed" },
      { status: 403 }
    );
  }

  // A recruiter-added (skip-path) candidate's POPIA consent was ATTESTED by the
  // recruiter, not given by the candidate — so popia_consent_at stayed null.
  // The candidate authenticating here (their own chat) is them personally
  // engaging, which upgrades the attestation to real consent. Idempotent: only
  // the first call flips the timestamp + audits.
  if (
    candidate.source === RECRUITER_MANUAL_SOURCE &&
    !candidate.popia_consent_at
  ) {
    await recordConsentConfirmed({
      orgId: candidate.org_id,
      candidateId: candidate.id,
    });
  }

  // Reactivate dormant conversations
  if (conv.status === "dormant") {
    await reactivateConversation(conversationId, conv.org_id);
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

  // Save user message to database. Public write: stamp org_id explicitly from
  // the resolved conversation rather than relying on the DB trigger (S13 drop).
  await db.insert(chatMessages).values({
    org_id: conv.org_id,
    conversation_id: conversationId,
    role: "user",
    content: userText,
  });

  // Volume counter — one chat_message per inbound candidate message (S10).
  recordUsageEvent({
    orgId: conv.org_id,
    kind: "chat_message",
    candidateId: conv.candidate_id,
  });

  // Provider/model backing all three chat LLM calls, for ai_tokens attribution.
  const chatModel = getChatModelMeta();

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

  const pendingTopics = topics
    .map((topic, index) => ({ ...topic, index }))
    .filter((topic) => !topic.covered);

  // Decide coverage now so this response's prompt reflects it — when the
  // candidate has just answered the final topic the model must see zero
  // pending topics to produce the wrap-up in this same reply. Persisted in
  // after() once the assistant reply is saved, so the re-score reads a
  // complete transcript.
  let coveredIndices: number[] = [];
  if (pendingTopics.length > 0) {
    const classification = await classifyTopicCoverage(
      history,
      userText,
      pendingTopics
    );
    coveredIndices = classification.coveredIndices;
    // Record only when the LLM call actually ran (usage present) — the regex
    // fallback path spends no tokens.
    if (classification.usage) {
      recordUsageEvent({
        orgId: conv.org_id,
        kind: "ai_tokens",
        provider: chatModel.providerName,
        model: chatModel.modelId,
        modelTier: "essential", // chat is hard-pinned to Essential
        inputTokens: classification.usage.inputTokens,
        outputTokens: classification.usage.outputTokens,
        candidateId: conv.candidate_id,
      });
    }
    if (coveredIndices.length > 0) {
      topics = topics.map((topic, index) =>
        coveredIndices.includes(index)
          ? { ...topic, covered: true, asked: false }
          : topic
      );
    }
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
    source: candidate.source,
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

      // Stream token usage is only available after the stream finishes —
      // totalUsage aggregates multi-step. Recorded here in after() so it never
      // stalls the stream to the client.
      const streamUsage = extractUsage(await result.totalUsage);
      recordUsageEvent({
        orgId: conv.org_id,
        kind: "ai_tokens",
        provider: chatModel.providerName,
        model: chatModel.modelId,
        modelTier: "essential", // chat is hard-pinned to Essential
        inputTokens: streamUsage.inputTokens,
        outputTokens: streamUsage.outputTokens,
        candidateId: conv.candidate_id,
      });

      let cleanText = stripThinking(text);
      if (reasoningText && cleanText.startsWith(reasoningText)) {
        cleanText = cleanText.slice(reasoningText.length).trim();
      }

      // Persist assistant response
      if (cleanText.trim()) {
        await db.insert(chatMessages).values({
          org_id: conv.org_id,
          conversation_id: conversationId,
          role: "assistant",
          content: cleanText,
        });
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

      // Persist progress before the withdrawal check — detectWithdrawal is
      // a full LLM round-trip, and a candidate who replies the moment the
      // stream ends must read fresh topic state or their answer's coverage
      // is silently lost. A withdrawal still can't be converted into a
      // completed conversation: classifyTopicCoverage covers nothing for
      // withdrawal-request messages, so there is no final transition to
      // record on a withdrawing candidate's message.
      await recordTopicProgress(conversationId, conv.org_id, {
        coveredIndices,
        askedIndex,
      });

      const withdrawal = await detectWithdrawal(history, cleanText);
      if (withdrawal.usage) {
        recordUsageEvent({
          orgId: conv.org_id,
          kind: "ai_tokens",
          provider: chatModel.providerName,
          model: chatModel.modelId,
          modelTier: "essential", // chat is hard-pinned to Essential
          inputTokens: withdrawal.usage.inputTokens,
          outputTokens: withdrawal.usage.outputTokens,
          candidateId: conv.candidate_id,
        });
      }
      if (withdrawal.withdrawn) {
        await withdrawConversation(conversationId, conv.org_id);
      }
    } catch (err) {
      console.error("Chat post-processing failed:", err);
    }
  });

  return result.toTextStreamResponse();
}

/**
 * Decide which pending topics the candidate's latest message covers.
 *
 * Coverage detection has swung both ways historically: a full-transcript
 * LLM eval marked unasked topics "indirectly covered" and closed chats
 * prematurely, while pure regex heuristics missed validly-phrased answers
 * and left chats circling forever (the prompt forces a question whenever a
 * topic is pending, so one missed answer reads as a loop to the candidate).
 * This is the middle ground: an LLM judgment scoped strictly to the current
 * exchange — the assistant's last message plus the candidate's reply — so
 * unusual phrasing can't defeat it but earlier messages can't leak coverage.
 *
 * Returns indices into the conversation's full topics array, plus the SDK
 * token usage of the classification call (null when the regex fallback ran and
 * no tokens were spent). Falls back to the regex heuristics (first pending
 * topic only) if the call fails.
 */
async function classifyTopicCoverage(
  history: { role: string; content: string }[],
  userText: string,
  pendingTopics: Array<Topic & { index: number }>
): Promise<{ coveredIndices: number[]; usage: TokenUsage | null }> {
  const lastAssistant = [...history]
    .reverse()
    .find((message) => message.role === "assistant");

  try {
    const { object, usage } = await generateObject({
      model: getChatModel(),
      schema: z.object({
        replyType: z
          .enum([
            "answer",
            "question",
            "acknowledgement",
            "stall",
            "refusal",
            "withdrawal_request",
          ])
          .describe(
            "What the candidate's latest message is doing. A message that both answers and asks something is an 'answer'."
          ),
        // No .int() — zod v4 renders it as integer-with-bounds JSON schema,
        // which the Anthropic structured-output endpoint rejects. Indices
        // are validated against the pending set below anyway.
        coveredTopicIndices: z
          .array(z.number())
          .describe(
            "Indices of pending topics that the candidate's latest message directly answers or explicitly declines to answer. Empty if none."
          ),
      }),
      prompt: `You are auditing one exchange in a recruitment chat. The assistant needs answers to a list of pending topics. Decide which pending topics, if any, the candidate's LATEST message covers.

Pending topics:
${pendingTopics.map((t) => `${t.index}. ${t.topic}`).join("\n")}

Assistant's last message:
${lastAssistant?.content ?? "(none — conversation just started)"}

Candidate's latest message:
${userText}

Rules:
- Judge ONLY the candidate's latest message. Anything the candidate said in earlier messages was already evaluated when it arrived and must NOT count now.
- A topic is covered when the latest message directly provides the information the topic asks for — either in response to the assistant's question or volunteered unprompted.
- A bare "yes" or "no" covers a topic when the assistant's last message posed that topic as a yes/no question.
- A topic is also covered when the candidate explicitly declines to answer it (classify the message as "refusal") — it must not be asked again.
- A message that only asks a question, acknowledges ("thanks", "ok, got it"), stalls ("one sec", "let me check"), or expresses readiness to start ("I'm ready") covers NOTHING.
- If the candidate is asking to withdraw from the process, or confirming withdrawal after the assistant asked, classify as "withdrawal_request" and cover nothing.
- Do NOT infer coverage from vague or tangential mentions — the information must be explicit.`,
    });

    // The call succeeded, so tokens were spent even on the withdrawal_request
    // branch — surface usage in both cases; only the regex fallback is free.
    const tokenUsage = extractUsage(usage);

    if (object.replyType === "withdrawal_request")
      return { coveredIndices: [], usage: tokenUsage };

    const validIndices = new Set(pendingTopics.map((t) => t.index));
    return {
      coveredIndices: object.coveredTopicIndices.filter((i: number) =>
        validIndices.has(i)
      ),
      usage: tokenUsage,
    };
  } catch (err) {
    console.error(
      "classifyTopicCoverage failed, falling back to heuristics:",
      err
    );
    const first = pendingTopics[0];
    return {
      coveredIndices:
        first && shouldMarkTopicCovered(history, userText, first)
          ? [first.index]
          : [],
      usage: null,
    };
  }
}

/**
 * Regex fallback for classifyTopicCoverage, used only when the LLM call
 * fails. Conservative: covers at most the first pending topic, and only
 * when the topic was armed as asked or the previous assistant message
 * looks like a question.
 */
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
): Promise<{ withdrawn: boolean; usage: TokenUsage | null }> {
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

    const { object, usage } = await generateObject({
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

    return { withdrawn: object.withdrawn, usage: extractUsage(usage) };
  } catch (err) {
    console.error("detectWithdrawal failed:", err);
    return { withdrawn: false, usage: null };
  }
}

/**
 * Strip <think>...</think> blocks from completed text.
 */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
