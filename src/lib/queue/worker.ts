import { db } from "@/db";
import { candidates, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  applicationReceivedEmail,
  chatInvitationEmail,
  chatNudgeEmail,
  gatingFailedEmail,
  gatingPassedEmail,
  noResponseEmail,
  rejectionConfirmationEmail,
  rejectionEmail,
  sendCandidateEmail,
} from "../email";
import { generateChatToken } from "../chat-auth";
import { createConversation, getActiveConversation } from "../chat";
import { rescoreWithChatContext } from "../ai-scoring";
import { processNewCandidate } from "../process-candidate";
import { getQueue } from "./index";
import type { JobPayload } from "./types";

export async function handleJob(payload: JobPayload): Promise<void> {
  switch (payload.type) {
    case "candidate-processing":
      await processNewCandidate(payload.candidateId);
      break;
    case "send-email":
      await handleEmailJob(payload);
      break;
    case "send-chat-invitation":
      await handleChatInvitation(payload);
      break;
    case "rescore-after-chat":
      await rescoreWithChatContext(
        payload.candidateId,
        payload.conversationId
      );
      break;
    case "chat-nudge":
      await handleChatNudge(payload);
      break;
    case "chat-expire":
      await handleChatExpire(payload);
      break;
    default:
      throw new Error(
        `Unknown job type: ${(payload as { type: string }).type}`
      );
  }
}

async function handleEmailJob(
  payload: Extract<JobPayload, { type: "send-email" }>
): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, payload.candidateId),
    with: { campaign: { with: { client: true } } },
  });

  if (!candidate) {
    console.error(
      `handleEmailJob: candidate ${payload.candidateId} not found`
    );
    return;
  }

  const { name, email, id: candidateId } = candidate;
  const roleTitle = candidate.campaign.role_title;
  const clientName = candidate.campaign.client?.name ?? "the company";

  switch (payload.emailKind) {
    case "application_received":
      await sendCandidateEmail(
        email,
        `Application received — ${roleTitle}`,
        applicationReceivedEmail(name, roleTitle, clientName),
        candidateId
      );
      break;
    case "gating_passed":
      await sendCandidateEmail(
        email,
        `Good news — ${roleTitle}`,
        gatingPassedEmail(name, roleTitle, clientName),
        candidateId
      );
      break;
    case "gating_failed":
      await sendCandidateEmail(
        email,
        `Application update — ${roleTitle}`,
        gatingFailedEmail(name, roleTitle, clientName),
        candidateId
      );
      break;
    case "rejected":
      await sendCandidateEmail(
        email,
        `Application update — ${roleTitle}`,
        rejectionEmail(name, roleTitle, clientName),
        candidateId
      );
      break;
    case "rejection_confirmation":
      // Backstop email after an in-chat rejection. Self-check: if the
      // candidate is no longer in `rejected` status, a re-score cancelled
      // the rejection mid-flight and this email should no-op.
      if (candidate.status !== "rejected") {
        console.log(
          `handleEmailJob: skipping rejection_confirmation for ${candidateId} — status is ${candidate.status}`
        );
        return;
      }
      await sendCandidateEmail(
        email,
        `Application update — ${roleTitle}`,
        rejectionConfirmationEmail(name, roleTitle, clientName, payload.adminReason),
        candidateId
      );
      break;
    case "no_response":
      // Terminal email for candidates who never engaged with the follow-up
      // chat. Self-check: status must still be no_response.
      if (candidate.status !== "no_response") {
        console.log(
          `handleEmailJob: skipping no_response for ${candidateId} — status is ${candidate.status}`
        );
        return;
      }
      await sendCandidateEmail(
        email,
        `Application update — ${roleTitle}`,
        noResponseEmail(name, roleTitle, clientName),
        candidateId
      );
      break;
  }
}

async function handleChatInvitation(
  payload: Extract<JobPayload, { type: "send-chat-invitation" }>
): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, payload.candidateId),
    with: { campaign: { with: { client: true } } },
  });

  if (!candidate) {
    console.error(
      `handleChatInvitation: candidate ${payload.candidateId} not found`
    );
    return;
  }

  // Ensure candidate has a chat token
  if (!candidate.chat_token_hash) {
    const token = generateChatToken();
    await db
      .update(candidates)
      .set({ chat_token_hash: token.hash, updated_at: new Date() })
      .where(eq(candidates.id, candidate.id));
  }

  const flags = (candidate.ai_flags ?? []) as string[];
  const lifecycle = candidate.campaign.chat_lifecycle ?? "dormant";
  const clientName = candidate.campaign.client?.name ?? "the company";
  const clientSlug = candidate.campaign.client?.slug;
  const campaignSlug = candidate.campaign.slug;

  // Create the conversation
  const conversationId = await createConversation(
    candidate.id,
    candidate.name,
    candidate.campaign.role_title,
    clientName,
    lifecycle,
    flags
  );

  // Build chat URL
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const chatUrl = `${appUrl}/c/${clientSlug}/${campaignSlug}/chat?t=${conversationId}`;

  // Send invitation email
  await sendCandidateEmail(
    candidate.email,
    `We'd like to chat about your application — ${candidate.campaign.role_title}`,
    chatInvitationEmail(
      candidate.name,
      candidate.campaign.role_title,
      clientName,
      chatUrl
    ),
    candidate.id
  );

  // Update candidate status to follow_up if not already
  if (candidate.status !== "follow_up") {
    await db
      .update(candidates)
      .set({ status: "follow_up", updated_at: new Date() })
      .where(eq(candidates.id, candidate.id));
  }

  // Schedule the nudge + expire jobs. Both are idempotent and self-check
  // guards at execution time — if the candidate engages, they no-op or
  // re-schedule themselves based on the updated last_activity_at.
  const ttlDays = candidate.campaign.ghost_ttl_days ?? 10;
  const nudgeAt = new Date(Date.now() + Math.max(1, ttlDays - 3) * 24 * 60 * 60 * 1000);
  const expireAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  const queue = getQueue();
  await Promise.all([
    queue.enqueue(
      { type: "chat-nudge", candidateId: candidate.id },
      { deliverAt: nudgeAt, deduplicationId: `nudge-${candidate.id}` }
    ),
    queue.enqueue(
      { type: "chat-expire", candidateId: candidate.id },
      { deliverAt: expireAt, deduplicationId: `expire-${candidate.id}` }
    ),
  ]);
}

// ── Ghost handling ─────────────────────────────────────────────────

async function handleChatNudge(
  payload: Extract<JobPayload, { type: "chat-nudge" }>
): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, payload.candidateId),
    with: { campaign: { with: { client: true } } },
  });

  if (!candidate) {
    console.error(`handleChatNudge: candidate ${payload.candidateId} not found`);
    return;
  }

  if (candidate.status !== "follow_up") {
    console.log(
      `handleChatNudge: skipping ${payload.candidateId} — status is ${candidate.status}`
    );
    return;
  }
  if (candidate.nudge_sent_at) {
    console.log(`handleChatNudge: skipping ${payload.candidateId} — already nudged`);
    return;
  }

  const conv = await getActiveConversation(candidate.id);
  if (!conv) {
    console.log(`handleChatNudge: skipping ${payload.candidateId} — no active conversation`);
    return;
  }

  const ttlDays = candidate.campaign.ghost_ttl_days ?? 10;
  const nudgeThresholdMs = Math.max(1, ttlDays - 3) * 24 * 60 * 60 * 1000;
  const lastActivityMs = new Date(conv.last_activity_at).getTime();
  const msSinceActivity = Date.now() - lastActivityMs;

  // Candidate was recently active — postpone the nudge. Activity-anchored
  // dedup key ensures retries of this re-enqueue are dropped, and engaged-
  // then-ghost candidates still get nudged after the full inactive window.
  if (msSinceActivity < nudgeThresholdMs) {
    const newDeliverAt = new Date(lastActivityMs + nudgeThresholdMs);
    await getQueue().enqueue(
      { type: "chat-nudge", candidateId: candidate.id },
      {
        deliverAt: newDeliverAt,
        deduplicationId: `nudge-${candidate.id}-${lastActivityMs}`,
      }
    );
    return;
  }

  const clientName = candidate.campaign.client?.name ?? "the company";
  const clientSlug = candidate.campaign.client?.slug;
  const campaignSlug = candidate.campaign.slug;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const chatUrl = `${appUrl}/c/${clientSlug}/${campaignSlug}/chat?t=${conv.id}`;

  // The close-by date is anchored to the candidate's last activity plus the
  // full TTL, matching what handleChatExpire will enforce.
  const closeByDate = new Date(
    lastActivityMs + ttlDays * 24 * 60 * 60 * 1000
  ).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await sendCandidateEmail(
    candidate.email,
    `Reminder — ${candidate.campaign.role_title}`,
    chatNudgeEmail(
      candidate.name,
      candidate.campaign.role_title,
      clientName,
      chatUrl,
      closeByDate
    ),
    candidate.id
  );

  await db
    .update(candidates)
    .set({ nudge_sent_at: new Date(), updated_at: new Date() })
    .where(eq(candidates.id, candidate.id));
}

async function handleChatExpire(
  payload: Extract<JobPayload, { type: "chat-expire" }>
): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, payload.candidateId),
    with: { campaign: true },
  });

  if (!candidate) {
    console.error(`handleChatExpire: candidate ${payload.candidateId} not found`);
    return;
  }

  if (candidate.status !== "follow_up") {
    console.log(
      `handleChatExpire: skipping ${payload.candidateId} — status is ${candidate.status}`
    );
    return;
  }

  const conv = await getActiveConversation(candidate.id);
  if (!conv) {
    console.log(`handleChatExpire: skipping ${payload.candidateId} — no active conversation`);
    return;
  }

  const ttlDays = candidate.campaign.ghost_ttl_days ?? 10;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const lastActivityMs = new Date(conv.last_activity_at).getTime();
  const msSinceActivity = Date.now() - lastActivityMs;

  // Candidate had some activity after the job was scheduled — re-schedule
  // for the new anchor. Activity-based dedup key means duplicate re-enqueues
  // (from worker retries) collapse to one row.
  if (msSinceActivity < ttlMs) {
    const newDeliverAt = new Date(lastActivityMs + ttlMs);
    await getQueue().enqueue(
      { type: "chat-expire", candidateId: candidate.id },
      {
        deliverAt: newDeliverAt,
        deduplicationId: `expire-${candidate.id}-${lastActivityMs}`,
      }
    );
    return;
  }

  // Transition the candidate to the terminal no_response state. This is
  // distinct from `rejected` — no evaluation was made about the candidate,
  // they just didn't participate.
  await db
    .update(candidates)
    .set({ status: "no_response", updated_at: new Date() })
    .where(eq(candidates.id, candidate.id));

  if (conv.status !== "closed") {
    await db
      .update(conversations)
      .set({
        status: "closed",
        closed_reason: "no_response",
        updated_at: new Date(),
      })
      .where(eq(conversations.id, conv.id));
  }

  // Fire the blameless closure email via the normal email job so retries
  // and logging are consistent with the other email paths.
  await getQueue().enqueue(
    { type: "send-email", candidateId: candidate.id, emailKind: "no_response" },
    { deduplicationId: `no-response-email-${candidate.id}` }
  );
}
