import { db } from "@/db";
import { candidates, scoringLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendFollowUpQuestion } from "./whatsapp";
import {
  callWithFallback,
  AllProvidersFailedError,
  SYSTEM_PROMPT,
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
  });

  // Auto-send follow-up if there are flags
  if (hasFlags) {
    sendFollowUpQuestion(candidateId).catch((err) =>
      console.error(`scoreCandidate: follow-up failed for ${candidateId}:`, err)
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
