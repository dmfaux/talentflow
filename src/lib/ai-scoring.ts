import { db } from "@/db";
import { candidates, chatMessages, scoringLogs } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getQueue } from "./queue";
import { recordUsageEvent } from "./usage";
import { recordRejectionRecommended } from "./rejection";
import {
  callWithFallback,
  resolveModelForTier,
  asModelTier,
  AllProvidersFailedError,
  SYSTEM_PROMPT,
  RESCORE_SYSTEM_PROMPT,
  type ScoringResult,
  type ProviderAttempt,
} from "./ai";

/** Resolve the scoring tier + Anthropic model for a candidate's campaign,
 *  clamped to the org's caps. Shared by initial scoring and chat re-scoring. */
function resolveScoringTier(c: {
  campaign: { selected_model_tier: string };
  organization: { max_model_tier: string; operator_max_model_tier: string };
}) {
  return resolveModelForTier(asModelTier(c.campaign.selected_model_tier), "scoring", {
    operatorMax: asModelTier(c.organization.operator_max_model_tier),
    orgMax: asModelTier(c.organization.max_model_tier),
  });
}

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
  /** Floor: candidates below this score with no flags are auto-rejected.
   *  Default 5. */
  min_score?: number;
  /** Ceiling: candidates at or above this score skip the follow-up chat and
   *  land directly in `scored`, regardless of flags. Default 8. */
  max_auto_advance_score?: number;
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
The following text was extracted from the candidate's uploaded CV document:
${cvText}

${gatingAnswers && Object.keys(gatingAnswers).length > 0 ? `## Screening Answers\n${JSON.stringify(gatingAnswers, null, 2)}` : ""}

## Instructions
1. Check dealbreakers FIRST. If any dealbreaker is triggered, set overall_score to 1.0 and recommendation to "reject".
2. Score each dimension from 1.0 to 10.0 (one decimal place).
3. Calculate overall_score as the weighted average using the dimension weights above.
4. Set confidence to "high" if the CV clearly supports the assessment, "medium" if some information is ambiguous, "low" if key information is missing.
5. **Flags are exceptional, not routine.** The expected default is an empty array — most candidates should receive zero flags. Only raise a flag when ALL of these hold: (a) it cites a specific item from the rubric above by name or close paraphrase — a must-have, nice-to-have, dealbreaker, or one of the four weighted dimensions; (b) it cannot be resolved from the CV text alone; (c) the answer would plausibly move the score. Maximum 2 flags. Do NOT flag formatting, grammar, stylistic concerns, communication tone, or anything that can be answered by re-reading the CV. Each flag must be a specific, bounded question answerable in 1-2 sentences — e.g. "The rubric requires 5+ years of Python but the CV lists Python as a skill without duration — roughly how long have you used Python professionally?" rather than "Tell me about your Python experience".
6. A CV document was uploaded and its extracted text is shown above. Do NOT claim that no CV or document was provided. If the text appears to be a job description, role profile, or other non-CV content rather than the candidate's personal work history, note this in your rationale and flag it as e.g. "Uploaded document appears to be a role profile/job description rather than a personal CV — can the candidate provide their actual CV with work history?"

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
  "flags": [] (empty is the expected default; max 2; see rule 5 above),
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
      organization: {
        columns: { max_model_tier: true, operator_max_model_tier: true },
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

  // Resolve the campaign's model tier (clamped to the org caps) → run that model
  // and bill that tier, even if a fallback provider ends up answering.
  const scoringTier = resolveScoringTier(candidate);

  // Call AI with provider fallback chain
  let aiResult;
  try {
    aiResult = await callWithFallback(SYSTEM_PROMPT, userPrompt, {
      anthropicModel: scoringTier.model,
    });
  } catch (err: unknown) {
    const attempts =
      err instanceof AllProvidersFailedError ? err.attempts : [];
    return handleApiFailure(
      candidateId,
      candidate.org_id,
      userPrompt,
      startTime,
      err,
      attempts
    );
  }

  const processingTimeMs = Date.now() - startTime;
  const result: ScoringResult = aiResult.output;

  // Meter the AI spend (best-effort; never blocks scoring). SDK token counts,
  // never estimates — see usage.ts.
  // Phase 7 (durability): billing reads the FROZEN usage_rollups / invoice_line_items
  // (see src/lib/billing.ts), which tolerate small fire-and-forget leakage from this
  // write. A transactional upgrade (alongside the scoring_logs insert) is deferred
  // until leakage is measured and shown to matter.
  recordUsageEvent({
    orgId: candidate.org_id,
    brandId: candidate.campaign.client_id,
    kind: "ai_tokens",
    provider: aiResult.providerName,
    model: aiResult.modelId,
    modelTier: scoringTier.tier,
    inputTokens: aiResult.usage.inputTokens,
    outputTokens: aiResult.usage.outputTokens,
    campaignId: candidate.campaign_id,
    candidateId: candidate.id,
  });

  // Determine status from the score and any flags raised.
  //
  // Three thresholds are at play:
  //   - max_auto_advance_score (ceiling, default 8): strong candidates skip
  //     the chat entirely and go directly to `scored`, even if flags exist.
  //   - min_score (floor, default 5): weak candidates with no flags are
  //     RECOMMENDED for rejection — parked in `pending_rejection` for a human to
  //     accept or dismiss. The AI never rejects on its own (no default reject).
  //     Weak candidates WITH flags still get a chat, since the chat might
  //     resolve the concerns and lift the score.
  //   - Otherwise: flags → follow_up chat, no flags → scored.
  const hasFlags = Array.isArray(result.flags) && result.flags.length > 0;
  const minScore = rubric.min_score ?? 5;
  const maxAutoAdvance = rubric.max_auto_advance_score ?? 8;
  const aboveMaxScore = result.overall_score >= maxAutoAdvance;
  const belowMinScore = result.overall_score < minScore;
  const priorStatus = candidate.status;

  const status: "scored" | "follow_up" | "pending_rejection" =
    aboveMaxScore
      ? "scored"
      : belowMinScore && !hasFlags
        ? "pending_rejection"
        : hasFlags
          ? "follow_up"
          : "scored";

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
      ...(status === "pending_rejection" && {
        rejection_reason: `Recommended for rejection: score ${result.overall_score.toFixed(1)} is below the minimum threshold of ${minScore}. Awaiting reviewer decision.`,
        rejection_recommended_at: new Date(),
      }),
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  // Write scoring log
  await db.insert(scoringLogs).values({
    org_id: candidate.org_id,
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
    dimensions: result.dimensions,
    confidence: result.confidence,
    rationale: result.rationale,
    flags: result.flags,
    recommendation: result.recommendation,
  });

  // Recommended for rejection — park in pending_rejection and record the
  // recommendation in the audit trail. NO email and NO status change to
  // `rejected` happen until a human accepts (handled by src/lib/rejection.ts).
  if (status === "pending_rejection") {
    await recordRejectionRecommended({
      orgId: candidate.org_id,
      candidateId,
      fromStatus: priorStatus,
      snapshot: {
        ai_score: result.overall_score,
        recommendation: result.recommendation ?? null,
        min_score: minScore,
        ai_rationale: result.rationale,
      },
    }).catch((err) =>
      console.error(
        `scoreCandidate: recommendation audit failed for ${candidateId}:`,
        err
      )
    );
    return;
  }

  // Open chat channel only when the candidate actually needs one.
  // Guarding on `status` (not `hasFlags`) ensures the high-water-mark
  // auto-advance path doesn't trigger a redundant chat invitation for a
  // strong-scoring candidate who happens to have flags attached.
  if (status === "follow_up") {
    getQueue()
      .enqueue(
        { type: "send-chat-invitation", candidateId },
        { orgId: candidate.org_id, deduplicationId: `chat-invite-${candidateId}` }
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
  orgId: string,
  prompt: string,
  startTime: number,
  err: unknown,
  attempts: ProviderAttempt[]
): Promise<void> {
  const processingTimeMs = Date.now() - startTime;
  const message = err instanceof Error ? err.message : "Unknown API error";
  console.error(`scoreCandidate: API failure for ${candidateId}:`, message);

  await db.insert(scoringLogs).values({
    org_id: orgId,
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
The following text was extracted from the candidate's uploaded CV document:
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
      organization: {
        columns: { max_model_tier: true, operator_max_model_tier: true },
      },
    },
  });

  if (!candidate) {
    console.error(`rescoreWithChatContext: candidate ${candidateId} not found`);
    return;
  }

  // A candidate the admin rejected mid-chat (pending_rejection_at set) is
  // still eligible: completing the chat re-score is the documented way an
  // in-flight rejection gets cancelled — the delayed rejection email
  // self-checks the status and no-ops once we write a new one.
  const pendingRejection =
    candidate.status === "rejected" && candidate.pending_rejection_at !== null;

  if (candidate.status !== "follow_up" && !pendingRejection) {
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

  // Re-scoring runs at the campaign's selected tier (clamped to org caps), the
  // same as initial scoring.
  const scoringTier = resolveScoringTier(candidate);

  let aiResult;
  try {
    aiResult = await callWithFallback(RESCORE_SYSTEM_PROMPT, userPrompt, {
      anthropicModel: scoringTier.model,
    });
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
      org_id: candidate.org_id,
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

  // Meter the re-score AI spend (best-effort).
  recordUsageEvent({
    orgId: candidate.org_id,
    brandId: candidate.campaign.client_id,
    kind: "ai_tokens",
    provider: aiResult.providerName,
    model: aiResult.modelId,
    modelTier: scoringTier.tier,
    inputTokens: aiResult.usage.inputTokens,
    outputTokens: aiResult.usage.outputTokens,
    campaignId: candidate.campaign_id,
    candidateId: candidate.id,
  });

  // Check minimum score threshold after follow-up.
  //
  // A still-below-min re-score splits by who is driving the rejection:
  //   - adminInitiated (the admin already rejected this candidate mid-chat):
  //     a human already decided, so honour it — stay `rejected` and keep the
  //     existing delayed-confirmation flow below.
  //   - otherwise (a follow_up candidate finished the chat and the AI still
  //     scores them out): that's an AI recommendation, so park in
  //     `pending_rejection` for a human — never a default reject.
  const minScore = rubric.min_score ?? 5;
  const belowMinScore = result.overall_score < minScore;
  const adminInitiated = pendingRejection;
  const newStatus: "scored" | "rejected" | "pending_rejection" = !belowMinScore
    ? "scored"
    : adminInitiated
      ? "rejected"
      : "pending_rejection";

  // Write updated scores to candidate. Clearing pending_rejection_at
  // cancels any in-flight admin rejection — the queued rejection email
  // self-checks the candidate status before sending.
  await db
    .update(candidates)
    .set({
      ai_score: result.overall_score,
      ai_dimensions: result.dimensions,
      ai_rationale: result.rationale,
      ai_confidence: result.confidence,
      ai_flags: result.flags,
      status: newStatus,
      pending_rejection_at: null,
      ...(newStatus === "rejected" && {
        rejection_reason: `Auto-rejected: score ${result.overall_score.toFixed(1)} remained below the minimum threshold of ${minScore} after follow-up`,
      }),
      ...(newStatus === "pending_rejection" && {
        rejection_reason: `Recommended for rejection: score ${result.overall_score.toFixed(1)} remained below the minimum threshold of ${minScore} after follow-up. Awaiting reviewer decision.`,
        rejection_recommended_at: new Date(),
      }),
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  // Write scoring log
  await db.insert(scoringLogs).values({
    org_id: candidate.org_id,
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
    dimensions: result.dimensions,
    confidence: result.confidence,
    rationale: result.rationale,
    flags: result.flags,
    recommendation: result.recommendation,
  });

  // Send rejection email after 24 hours if auto-rejected after follow-up
  // (admin-initiated path only — the human already decided).
  if (newStatus === "rejected") {
    const deliverAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    getQueue()
      .enqueue(
        { type: "send-email", candidateId, emailKind: "rejected" },
        { orgId: candidate.org_id, deliverAt, deduplicationId: `rejection-rescore-${candidateId}` }
      )
      .catch((err) =>
        console.error(
          `rescoreWithChatContext: rejection email failed for ${candidateId}:`,
          err
        )
      );
  }

  // Recommended for rejection after follow-up — park for a human, no email.
  if (newStatus === "pending_rejection") {
    await recordRejectionRecommended({
      orgId: candidate.org_id,
      candidateId,
      fromStatus: "follow_up",
      snapshot: {
        ai_score: result.overall_score,
        recommendation: result.recommendation ?? null,
        min_score: minScore,
        ai_rationale: result.rationale,
      },
    }).catch((err) =>
      console.error(
        `rescoreWithChatContext: recommendation audit failed for ${candidateId}:`,
        err
      )
    );
  }
}
