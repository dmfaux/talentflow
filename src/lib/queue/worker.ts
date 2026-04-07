import { db } from "@/db";
import { candidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  applicationReceivedEmail,
  gatingFailedEmail,
  gatingPassedEmail,
  sendCandidateEmail,
} from "../email";
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
  }
}
