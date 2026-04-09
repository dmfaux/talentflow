import { db } from "@/db";
import { candidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  applicationReceivedEmail,
  chatInvitationEmail,
  gatingFailedEmail,
  gatingPassedEmail,
  rejectionEmail,
  sendCandidateEmail,
} from "../email";
import { generateChatToken } from "../chat-auth";
import { createConversation } from "../chat";
import { rescoreWithChatContext } from "../ai-scoring";
import { processNewCandidate } from "../process-candidate";
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
}
