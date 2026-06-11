import { db } from "@/db";
import { candidates, chatMessages, conversations } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { reframeFlag } from "./ai/chat-prompt";
import { getQueue } from "./queue";

// ── Types ───────────────────────────────────────────────────────────

export interface Topic {
  flag: string;
  topic: string;
  covered: boolean;
  asked?: boolean;
}

// ── Create conversation ─────────────────────────────────────────────

export async function createConversation(
  candidateId: string,
  candidateName: string,
  roleTitle: string,
  companyName: string,
  lifecycle: string,
  flags: string[]
): Promise<string> {
  const topics: Topic[] = flags.slice(0, 4).map((flag) => ({
    flag,
    topic: reframeFlag(flag),
    covered: false,
  }));

  const [conv] = await db
    .insert(conversations)
    .values({
      candidate_id: candidateId,
      lifecycle,
      topics,
    })
    .returning({ id: conversations.id });

  // Insert initial greeting message
  const topicCount = topics.length;
  const greeting =
    topicCount > 0
      ? `Hi ${candidateName}! Thanks for applying for the ${roleTitle} position at ${companyName}. I just have ${topicCount} quick question${topicCount === 1 ? "" : "s"} to help the team get a clearer picture of your application. Let me know when you're ready!`
      : `Hi ${candidateName}! Thanks for applying for the ${roleTitle} position at ${companyName}. The recruitment team would like to learn a bit more about your background. Let me know when you're ready and we can get started!`;

  await db.insert(chatMessages).values({
    conversation_id: conv.id,
    role: "assistant",
    content: greeting,
  });

  return conv.id;
}

// ── Get active conversation ─────────────────────────────────────────

export async function getActiveConversation(candidateId: string) {
  return db.query.conversations.findFirst({
    where: and(
      eq(conversations.candidate_id, candidateId),
      inArray(conversations.status, ["active", "dormant"])
    ),
  });
}

// ── Reactivate dormant conversation ─────────────────────────────────

export async function reactivateConversation(
  conversationId: string
): Promise<void> {
  await db
    .update(conversations)
    .set({
      status: "active",
      last_activity_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

// ── Record per-message topic progress ───────────────────────────────

export interface TopicProgress {
  /** Indices of the topics the candidate's latest message covered. */
  coveredIndices?: number[];
  /** Index of the topic the assistant's reply asked about. */
  askedIndex?: number;
}

/**
 * Persist a message's topic progress in one atomic read-modify-write.
 * The conversation row is locked for the duration of the transaction so
 * concurrent requests for the same conversation cannot interleave between
 * read and write (e.g. a slow post-stream callback racing the next
 * message's processing).
 *
 * When the final topic is covered the conversation is closed (where the
 * lifecycle calls for it) and an automatic re-score is enqueued — after
 * the row update commits, so a queue failure cannot lose conversation
 * state, and only on the call that performed the final transition so a
 * later message cannot enqueue a duplicate re-score.
 */
export async function recordTopicProgress(
  conversationId: string,
  progress: TopicProgress
): Promise<void> {
  const completed = await db.transaction(async (tx) => {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");

    if (!conv) return null;

    const topics = (conv.topics ?? []) as Topic[];
    let coveredThisCall = false;

    for (const index of progress.coveredIndices ?? []) {
      const topic = topics[index];
      if (topic && !topic.covered) {
        topic.covered = true;
        topic.asked = false;
        coveredThisCall = true;
      }
    }

    if (progress.askedIndex !== undefined) {
      const topic = topics[progress.askedIndex];
      if (topic && !topic.covered) topic.asked = true;
    }

    const allCovered = topics.length > 0 && topics.every((t) => t.covered);
    const shouldClose =
      allCovered &&
      conv.lifecycle === "topics_complete" &&
      conv.status !== "closed";

    await tx
      .update(conversations)
      .set({
        topics,
        topics_covered_count: topics.filter((t) => t.covered).length,
        last_activity_at: new Date(),
        updated_at: new Date(),
        ...(shouldClose && {
          status: "closed",
          closed_reason: "topics_complete",
        }),
      })
      .where(eq(conversations.id, conversationId));

    return allCovered && coveredThisCall
      ? { candidateId: conv.candidate_id }
      : null;
  });

  if (!completed) return;

  try {
    await getQueue().enqueue(
      {
        type: "rescore-after-chat",
        candidateId: completed.candidateId,
        conversationId,
      },
      { deduplicationId: `rescore-chat-${conversationId}` }
    );
  } catch (err) {
    console.error(
      `recordTopicProgress: rescore enqueue failed for ${conversationId}:`,
      err
    );
  }
}

// ── Close chat on admin rejection (templated, no AI) ──────────────

/**
 * Posts a fully-templated assistant message informing the candidate that
 * the recruitment team has decided not to move forward, closes the chat,
 * and tags the close reason. Called from the admin-reject PATCH route for
 * candidates currently in a live chat.
 *
 * This function does NOT compose anything with an AI — the message is a
 * fixed scaffold with an optional admin-supplied note appended verbatim.
 * See Q1a decision in the design discussion for why.
 *
 * The caller is responsible for updating `candidates.status` — this
 * function only touches the conversation/chat surface.
 */
export async function closeChatWithRejection(
  conversationId: string,
  roleTitle: string,
  companyName: string,
  adminReason?: string
): Promise<void> {
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conv || conv.status === "closed") return;

  const cleanedReason = adminReason?.trim();
  const reasonSentence = cleanedReason
    ? ` They've asked me to share the following note: "${cleanedReason}".`
    : "";

  const message =
    `Thank you for your time on this application. The recruitment team for ${roleTitle} at ${companyName} has reached a decision and won't be moving forward with your application.${reasonSentence} We wish you the very best in your search.`;

  await db.insert(chatMessages).values({
    conversation_id: conversationId,
    role: "assistant",
    content: message,
  });

  await db
    .update(conversations)
    .set({
      status: "closed",
      closed_reason: "rejected_by_admin",
      last_activity_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

// ── Withdraw conversation ──────────────────────────────────────────

export async function withdrawConversation(
  conversationId: string
): Promise<void> {
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conv || conv.status === "closed") return;

  await db
    .update(conversations)
    .set({
      status: "closed",
      closed_reason: "candidate_withdrawn",
      updated_at: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  await db
    .update(candidates)
    .set({ status: "withdrawn", updated_at: new Date() })
    .where(eq(candidates.id, conv.candidate_id));
}
