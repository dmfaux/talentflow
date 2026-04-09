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

// ── Update activity & track topic coverage ──────────────────────────

export async function updateConversationActivity(
  conversationId: string,
  coveredIndices: number[]
): Promise<void> {
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conv) return;

  const topics = (conv.topics ?? []) as Topic[];
  let newCovered = 0;

  for (const idx of coveredIndices) {
    if (topics[idx] && !topics[idx].covered) {
      topics[idx].covered = true;
      newCovered++;
    }
  }

  const totalCovered = (conv.topics_covered_count ?? 0) + newCovered;
  const allCovered = topics.length > 0 && topics.every((t) => t.covered);

  // Check if lifecycle dictates closing
  let newStatus = conv.status;
  let closedReason: string | null = null;

  if (allCovered && conv.lifecycle === "topics_complete") {
    newStatus = "closed";
    closedReason = "topics_complete";
  }

  await db
    .update(conversations)
    .set({
      topics,
      topics_covered_count: totalCovered,
      last_activity_at: new Date(),
      updated_at: new Date(),
      ...(newStatus !== conv.status && { status: newStatus }),
      ...(closedReason && { closed_reason: closedReason }),
    })
    .where(eq(conversations.id, conversationId));

  // Trigger automatic re-score when all topics have been covered
  if (allCovered) {
    getQueue()
      .enqueue(
        {
          type: "rescore-after-chat",
          candidateId: conv.candidate_id,
          conversationId,
        },
        { deduplicationId: `rescore-chat-${conversationId}` }
      )
      .catch((err) =>
        console.error(
          `updateConversationActivity: rescore enqueue failed for ${conversationId}:`,
          err
        )
      );
  }
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

