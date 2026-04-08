import { db } from "@/db";
import { chatMessages, conversations } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { reframeFlag } from "./ai/chat-prompt";

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
  const topics: Topic[] = flags.map((flag) => ({
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
  const greeting =
    flags.length > 0
      ? `Hi ${candidateName}! Thanks for applying for the ${roleTitle} position at ${companyName}. I have a few follow-up questions about your application — this should only take a few minutes. Let's get started!`
      : `Hi ${candidateName}! Thanks for applying for the ${roleTitle} position at ${companyName}. The recruitment team would like to learn a bit more about your background. How are you doing today?`;

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
}

// ── Parse [TOPIC_COVERED:N] markers from AI response ────────────────

export function parseCoveredTopics(text: string): number[] {
  const matches = text.matchAll(/\[topic_covered:(\d+)\]/gi);
  return [...matches].map((m) => parseInt(m[1], 10));
}

// ── Strip markers from display text ─────────────────────────────────

export function stripTopicMarkers(text: string): string {
  return text.replace(/\s*\[topic_covered:\d+\]/gi, "").trim();
}
