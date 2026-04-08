import { db } from "@/db";
import { candidates, chatMessages, scoringLogs } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getQueue } from "./queue";
import {
  callWithFallback,
  AllProvidersFailedError,
  SYSTEM_PROMPT,
  RESCORE_SYSTEM_PROMPT,
  type ScoringResult,
  type ProviderAttempt,
} from "./ai";

// ── Types ────────────────────────────────────────────────────────────

interface ScoringRubric {
  must_haves: string[];
  nice_to_haves: string[];
  dealbreakers: string[];
  dimension_weights: {
    skills: number;
    experience: number;
    progression: number;
    tenure: number;
  };
}

// ── Prompt builder ───────────────────────────────────────────────────

export function buildScoringPrompt(
  roleTitle: string,
  roleDescription: string | null,
  rubric: ScoringRubric,
  cvText: string,
  gatingAnswers: Record<string, string> | null
): string {
  const weights = rubric.dimension_weights;

  return `## Role
**Title:** ${roleTitle}
${roleDescription ? `**Description:** ${roleDescription}` : ""}

## Scoring Rubric

**Must-Haves:**
${rubric.must_haves.map((h) => `- ${h}`).join("\n") || "- None specified"}

**Nice-to-Haves:**
${rubric.nice_to_haves.map((h) => `- ${h}`).join("\n") || "- None specified"}

**Dealbreakers (auto-reject if any triggered):**
${rubric.dealbreakers.map((d) => `- ${d}`).join("\n") || "- None specified"}

**Dimension Weights:**
- Skills Match: ${weights.skills}%
- Experience Depth: ${weights.experience}%
- Career Progression: ${weights.progression}%
- Tenure Patterns: ${weights.tenure}%

## Candidate CV
${cvText}

${gatingAnswers && Object.keys(gatingAnswers).length > 0 ? `## Screening Answers\n${JSON.stringify(gatingAnswers, null, 2)}` : ""}

## Instructions
1. Check dealbreakers FIRST. If any dealbreaker is triggered, set overall_score to 1.0 and recommendation to "reject".
2. Score each dimension from 1.0 to 10.0 (one decimal place).
3. Calculate overall_score as the weighted average using the dimension weights above.
4. Set confidence to "high" if the CV clearly supports the assessment, "medium" if some information is ambiguous, "low" if key information is missing.
5. List any ambiguities, red flags, or concerns in the flags array. Leave empty if none.

Respond with exactly this JSON structure:
{
  "overall_score": <number 1.0-10.0>,
  "dimensions": {
    "skills_match": <number>,
    "experience_depth": <number>,
    "career_progression": <number>,
    "tenure_patterns": <number>
  },
  "confidence": "high" | "medium" | "low",
  "rationale": "<2-3 sentence assessment>",
  "flags": ["<string>", ...],
  "recommendation": "strong_recommend" | "recommend" | "recommend_with_caveats" | "borderline" | "reject"
}`;
}

// ── Score candidate ──────────────────────────────────────────────────

export async function scoreCandidate(candidateId: string): Promise<void> {
  // Fetch candidate with campaign and client
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, candidateId),
    with: {
      campaign: {
        with: { client: true },
      },
    },
  });

  if (!candidate) {
    console.error(`scoreCandidate: candidate ${candidateId} not found`);
    return;
  }

  if (!candidate.cv_text) {
    console.error(`scoreCandidate: candidate ${candidateId} has no CV text`);
    return;
  }

  const rubric = candidate.campaign.scoring_rubric as ScoringRubric;
  const userPrompt = buildScoringPrompt(
    candidate.campaign.role_title,
    candidate.campaign.role_description,
    rubric,
    candidate.cv_text,
    candidate.gating_answers as Record<string, string> | null
  );

  const startTime = Date.now();

  // Call AI with provider fallback chain
  let aiResult;
  try {
    aiResult = await callWithFallback(SYSTEM_PROMPT, userPrompt);
  } catch (err: unknown) {
    const attempts =
      err instanceof AllProvidersFailedError ? err.attempts : [];
    return handleApiFailure(candidateId, userPrompt, startTime, err, attempts);
  }

  const processingTimeMs = Date.now() - startTime;
  const result: ScoringResult = aiResult.output;

  // Determine status based on flags
  const hasFlags = Array.isArray(result.flags) && result.flags.length > 0;
  const status = hasFlags ? "follow_up" : "scored";

  // Write results to candidate
  await db
    .update(candidates)
    .set({
      ai_score: result.overall_score,
      ai_dimensions: result.dimensions,
      ai_rationale: result.rationale,
      ai_confidence: result.confidence,
      ai_flags: result.flags,
      status,
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  // Write scoring log
  await db.insert(scoringLogs).values({
    candidate_id: candidateId,
    provider: aiResult.providerName,
    model_version: aiResult.modelId,
    full_prompt: SYSTEM_PROMPT + "\n\n" + userPrompt,
    full_response: aiResult.text,
    score: result.overall_score,
    processing_time_ms: processingTimeMs,
    fallback_chain:
      aiResult.attempts.length > 0 ? aiResult.attempts : null,
    scoring_type: "initial",
  });

  // Open chat channel if there are flags
  if (hasFlags) {
    getQueue()
      .enqueue(
        { type: "send-chat-invitation", candidateId },
        { deduplicationId: `chat-invite-${candidateId}` }
      )
      .catch((err) =>
        console.error(
          `scoreCandidate: chat invitation failed for ${candidateId}:`,
          err
        )
      );
  }
}

async function handleApiFailure(
  candidateId: string,
  prompt: string,
  startTime: number,
  err: unknown,
  attempts: ProviderAttempt[]
): Promise<void> {
  const processingTimeMs = Date.now() - startTime;
  const message = err instanceof Error ? err.message : "Unknown API error";
  console.error(`scoreCandidate: API failure for ${candidateId}:`, message);

  await db.insert(scoringLogs).values({
    candidate_id: candidateId,
    provider: attempts.length > 0 ? attempts[attempts.length - 1].provider : null,
    model_version: "unknown",
    full_prompt: SYSTEM_PROMPT + "\n\n" + prompt,
    full_response: `ERROR: ${message}`,
    score: null,
    processing_time_ms: processingTimeMs,
    fallback_chain: attempts.length > 0 ? attempts : null,
  });

  await db
    .update(candidates)
    .set({
      status: "scored",
      ai_flags: [{ type: "api_error", message }],
      ai_rationale:
        "AI scoring failed due to an API error. Manual review required.",
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));
}

// ── Chat-augmented re-scoring ───────────────────────────────────────

interface ChatMessage {
  role: string;
  content: string;
  created_at: Date;
}

function formatTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const ts = m.created_at.toISOString().replace("T", " ").slice(0, 16);
      const speaker = m.role === "user" ? "CANDIDATE" : "ASSISTANT";
      return `[${ts}] ${speaker}: ${m.content}`;
    })
    .join("\n");
}

export function buildRescorePrompt(
  roleTitle: string,
  roleDescription: string | null,
  rubric: ScoringRubric,
  cvText: string,
  gatingAnswers: Record<string, string> | null,
  originalScore: number,
  originalConfidence: string,
  originalRationale: string,
  originalFlags: string[],
  originalRecommendation: string | null,
  transcript: string
): string {
  const weights = rubric.dimension_weights;

  return `## Role
**Title:** ${roleTitle}
${roleDescription ? `**Description:** ${roleDescription}` : ""}

## Scoring Rubric

**Must-Haves:**
${rubric.must_haves.map((h) => `- ${h}`).join("\n") || "- None specified"}

**Nice-to-Haves:**
${rubric.nice_to_haves.map((h) => `- ${h}`).join("\n") || "- None specified"}

**Dealbreakers (auto-reject if any triggered):**
${rubric.dealbreakers.map((d) => `- ${d}`).join("\n") || "- None specified"}

**Dimension Weights:**
- Skills Match: ${weights.skills}%
- Experience Depth: ${weights.experience}%
- Career Progression: ${weights.progression}%
- Tenure Patterns: ${weights.tenure}%

## Candidate CV
${cvText}

${gatingAnswers && Object.keys(gatingAnswers).length > 0 ? `## Screening Answers\n${JSON.stringify(gatingAnswers, null, 2)}` : ""}

## Original Assessment
- **Overall Score:** ${originalScore}
- **Confidence:** ${originalConfidence}
- **Rationale:** ${originalRationale}
- **Flags Raised:** ${originalFlags.map((f) => `"${f}"`).join(", ")}
${originalRecommendation ? `- **Recommendation:** ${originalRecommendation}` : ""}

## Follow-Up Chat Transcript
The following is a conversation between the candidate and a recruitment assistant.
The chat was initiated to investigate the flags listed above.

${transcript}

## Re-Scoring Instructions

You are re-evaluating this candidate after a follow-up chat addressed the flags from the original assessment. Apply these principles:

1. **Pessimistic interpretation of chat responses**: Candidates can prepare and rehearse answers. Treat chat responses as the candidate's *best possible framing* of the situation. Weight concrete, verifiable claims (dates, company names, specific projects) more heavily than vague assurances.

2. **Flags can be resolved, partially resolved, or confirmed**:
   - RESOLVED: The candidate provided specific, verifiable context that fully explains the concern (e.g., a tenure gap was due to a documented acquisition/merger, or a career break for a completed degree).
   - PARTIALLY RESOLVED: The candidate addressed the concern but the explanation is vague, generic, or unverifiable.
   - CONFIRMED: The candidate's response reinforced the concern, was evasive, or contradicted their CV.

3. **Score adjustment rules**:
   - A resolved flag may increase the relevant dimension score by up to 1.0 point.
   - A partially resolved flag should leave the dimension score unchanged.
   - A confirmed flag should decrease the relevant dimension score by 0.5 to 1.5 points.
   - The overall_score is recalculated as the weighted average using the dimension weights above.

4. **Confidence should generally increase** after a chat (more data = more signal), unless the candidate's responses were contradictory or evasive.

5. **Do not give credit for enthusiasm, politeness, or communication skills** unless "communication" is explicitly in the rubric's must-haves.

6. **Update the flags array**: Remove flags that were resolved, keep flags that were partially resolved or confirmed, and add any new concerns that emerged from the chat.

Respond with exactly this JSON structure:
{
  "overall_score": <number 1.0-10.0>,
  "dimensions": {
    "skills_match": <number>,
    "experience_depth": <number>,
    "career_progression": <number>,
    "tenure_patterns": <number>
  },
  "confidence": "high" | "medium" | "low",
  "rationale": "<2-3 sentence assessment incorporating chat findings>",
  "flags": ["<string>", ...],
  "recommendation": "strong_recommend" | "recommend" | "recommend_with_caveats" | "borderline" | "reject"
}`;
}

export async function rescoreWithChatContext(
  candidateId: string,
  conversationId: string
): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, candidateId),
    with: {
      campaign: {
        with: { client: true },
      },
    },
  });

  if (!candidate) {
    console.error(`rescoreWithChatContext: candidate ${candidateId} not found`);
    return;
  }

  if (candidate.status !== "follow_up") {
    console.warn(
      `rescoreWithChatContext: candidate ${candidateId} is ${candidate.status}, not follow_up — skipping`
    );
    return;
  }

  if (!candidate.cv_text) {
    console.error(
      `rescoreWithChatContext: candidate ${candidateId} has no CV text`
    );
    return;
  }

  // Fetch chat messages
  const messages = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      created_at: chatMessages.created_at,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversation_id, conversationId))
    .orderBy(asc(chatMessages.created_at));

  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) {
    console.warn(
      `rescoreWithChatContext: no user messages in conversation ${conversationId}, skipping`
    );
    return;
  }

  // Format transcript, truncate if very long
  let transcript = formatTranscript(messages);
  if (transcript.length > 8000) {
    transcript =
      "... [earlier messages truncated] ...\n" + transcript.slice(-8000);
  }

  const rubric = candidate.campaign.scoring_rubric as ScoringRubric;
  const originalFlags = Array.isArray(candidate.ai_flags)
    ? (candidate.ai_flags as string[])
    : [];

  // Infer recommendation from the original score for prompt context
  const originalRecommendation =
    candidate.ai_score != null && candidate.ai_score <= 1
      ? "reject"
      : candidate.ai_score != null && candidate.ai_score >= 8
        ? "recommend"
        : null;

  const userPrompt = buildRescorePrompt(
    candidate.campaign.role_title,
    candidate.campaign.role_description,
    rubric,
    candidate.cv_text,
    candidate.gating_answers as Record<string, string> | null,
    candidate.ai_score ?? 0,
    candidate.ai_confidence ?? "low",
    candidate.ai_rationale ?? "",
    originalFlags,
    originalRecommendation,
    transcript
  );

  const startTime = Date.now();

  let aiResult;
  try {
    aiResult = await callWithFallback(RESCORE_SYSTEM_PROMPT, userPrompt);
  } catch (err: unknown) {
    const processingTimeMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Unknown API error";
    const attempts =
      err instanceof AllProvidersFailedError ? err.attempts : [];
    console.error(
      `rescoreWithChatContext: API failure for ${candidateId}:`,
      message
    );

    await db.insert(scoringLogs).values({
      candidate_id: candidateId,
      provider:
        attempts.length > 0 ? attempts[attempts.length - 1].provider : null,
      model_version: "unknown",
      full_prompt: RESCORE_SYSTEM_PROMPT + "\n\n" + userPrompt,
      full_response: `ERROR: ${message}`,
      score: null,
      processing_time_ms: processingTimeMs,
      fallback_chain: attempts.length > 0 ? attempts : null,
      scoring_type: "chat_rescore",
    });

    // Do NOT change status — leave as follow_up for retry/manual review
    return;
  }

  const processingTimeMs = Date.now() - startTime;
  const result: ScoringResult = aiResult.output;

  // Write updated scores to candidate
  await db
    .update(candidates)
    .set({
      ai_score: result.overall_score,
      ai_dimensions: result.dimensions,
      ai_rationale: result.rationale,
      ai_confidence: result.confidence,
      ai_flags: result.flags,
      status: "scored",
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  // Write scoring log
  await db.insert(scoringLogs).values({
    candidate_id: candidateId,
    provider: aiResult.providerName,
    model_version: aiResult.modelId,
    full_prompt: RESCORE_SYSTEM_PROMPT + "\n\n" + userPrompt,
    full_response: aiResult.text,
    score: result.overall_score,
    processing_time_ms: processingTimeMs,
    fallback_chain:
      aiResult.attempts.length > 0 ? aiResult.attempts : null,
    scoring_type: "chat_rescore",
  });
}
