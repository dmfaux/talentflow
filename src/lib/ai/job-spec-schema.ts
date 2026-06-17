import { z } from "zod";
import { generateText, Output } from "ai";
import {
  type ProviderName,
  getProviderChain,
  getModelId,
} from "./config";
import {
  getProviderFactory,
  extractUsage,
  type ProviderAttempt,
  type TokenUsage,
  AllProvidersFailedError,
} from "./providers";

// ── Zod schema ──────────────────────────────────────────────────────

// NOTE: Anthropic's structured output rejects minItems/maxItems/maxLength/
// min/max and .refine(). Keep this schema free of those constraints — enforce
// them in validateQuality() instead.

const GatingQuestionSchema = z.object({
  label: z.string().describe("The screening question text"),
  options: z
    .array(
      z.object({
        value: z.string().describe("An answer option (max 80 chars)"),
      })
    )
    .describe("2-6 answer options"),
  pass_criteria: z
    .array(z.string())
    .describe("Which option values should pass screening (at least 1)"),
});

export const JobSpecResultSchema = z.object({
  role_title: z
    .string()
    .describe("The job title, concise (e.g. 'Senior Software Engineer')"),
  role_description: z
    .string()
    .describe(
      "A markdown-formatted description of the role, responsibilities, and opportunity. 2-4 paragraphs."
    ),
  department: z
    .string()
    .nullable()
    .describe("The department or team, or null if not mentioned"),
  location: z
    .string()
    .nullable()
    .describe("The job location, or null if not mentioned"),
  employment_type: z
    .enum(["Permanent", "Contract", "Temporary", "Freelance"])
    .nullable()
    .describe("The employment type, or null if not clear"),
  salary_range_min: z
    .number()
    .nullable()
    .describe("Minimum salary in ZAR as integer, or null if not mentioned"),
  salary_range_max: z
    .number()
    .nullable()
    .describe("Maximum salary in ZAR as integer, or null if not mentioned"),
  gating_questions: z
    .array(GatingQuestionSchema)
    .describe(
      "1-5 gating/screening questions derived from hard requirements in the job spec"
    ),
  must_haves: z
    .array(z.string())
    .describe("Essential requirements from the job spec (at least 1)"),
  nice_to_haves: z
    .array(z.string())
    .describe("Desirable but non-essential qualifications"),
  dealbreakers: z
    .array(z.string())
    .describe("Absolute disqualifiers"),
  dimension_weights: z
    .object({
      skills: z.number().describe("0-100"),
      experience: z.number().describe("0-100"),
      progression: z.number().describe("0-100"),
      tenure: z.number().describe("0-100"),
    })
    .describe("Must sum to exactly 100"),
  design_brief: z
    .string()
    .describe(
      "A concise design brief (50 words or fewer) for the landing page template, describing tone, style, and key visual direction"
    ),
});

export type JobSpecResult = z.infer<typeof JobSpecResultSchema>;

// ── Prompts ─────────────────────────────────────────────────────────

const JOB_SPEC_SYSTEM_PROMPT = `You are an expert recruitment consultant. You analyse job specifications and extract structured campaign configuration for an AI-powered candidate screening platform.

You MUST respond with a single valid JSON object matching the exact schema specified. Do not include any text outside the JSON object. Do not wrap it in markdown code fences.

Rules:
- Be faithful to the source document. Do not invent requirements that are not stated or implied.
- For gating questions: derive 3-5 screening questions from the hardest requirements (e.g. right to work, required qualifications, years of experience, location availability). Each question must have 2-6 answer options with clear pass/fail criteria. Each option must be under 80 characters. The pass_criteria array must contain values that exactly match the value field of one or more options.
- For scoring rubric: extract must-haves (essential requirements), nice-to-haves (preferred qualifications), and dealbreakers (absolute disqualifiers) directly from the job spec language.
- For dimension weights: allocate exactly 100 points across skills, experience, progression, and tenure based on what the job spec emphasises most.
- For the design brief: write a concise (max 50 words) creative direction for a landing page — mention tone (e.g. corporate, startup, technical), mood, and any industry-specific visual cues suggested by the role. DO NOT suggest colors as a predefined theme is alreaduy in place`;

export function buildJobSpecPrompt(
  extractedText: string,
  clientName: string
): string {
  return `Analyse the following job specification for ${clientName} and extract structured campaign configuration.

JOB SPECIFICATION:
---
${extractedText}
---

Extract all fields according to the schema. If the job spec does not mention a field (e.g. salary, location), return null for that field. For gating questions, focus on the most important hard requirements that can be answered with a simple dropdown selection.`;
}

// ── Quality validation ──────────────────────────────────────────────

export class JobSpecQualityError extends Error {
  constructor(public issues: string[]) {
    super(`Quality validation failed: ${issues.join("; ")}`);
    this.name = "JobSpecQualityError";
  }
}

function validateQuality(result: JobSpecResult): void {
  const issues: string[] = [];

  // ── Gating questions: count ───────────────────────────────────────
  if (result.gating_questions.length === 0) {
    issues.push("At least 1 gating question is required");
  } else if (result.gating_questions.length > 5) {
    issues.push(`Too many gating questions (${result.gating_questions.length}, max 5)`);
  }

  // ── Gating questions: per-question checks ─────────────────────────
  for (const [i, q] of result.gating_questions.entries()) {
    if (q.options.length < 2) {
      issues.push(`Gating question ${i + 1}: needs at least 2 options`);
    } else if (q.options.length > 6) {
      issues.push(`Gating question ${i + 1}: too many options (${q.options.length}, max 6)`);
    }
    for (const [j, opt] of q.options.entries()) {
      if (opt.value.length > 80) {
        issues.push(`Gating question ${i + 1}, option ${j + 1}: exceeds 80 chars`);
      }
    }
    if (q.pass_criteria.length === 0) {
      issues.push(`Gating question ${i + 1}: needs at least 1 pass criterion`);
    }
    const optionValues = new Set(q.options.map((o) => o.value));
    for (const pc of q.pass_criteria) {
      if (!optionValues.has(pc)) {
        issues.push(
          `Gating question ${i + 1}: pass_criteria "${pc}" not found in options`
        );
      }
    }
  }

  // ── Must-haves ────────────────────────────────────────────────────
  if (result.must_haves.length === 0) {
    issues.push("At least 1 must-have requirement is required");
  }

  // ── Dimension weights ─────────────────────────────────────────────
  const w = result.dimension_weights;
  const sum = w.skills + w.experience + w.progression + w.tenure;
  if (sum !== 100) {
    issues.push(`Dimension weights sum to ${sum}, must be exactly 100`);
  }
  for (const [key, val] of Object.entries(w)) {
    if (val < 0 || val > 100) {
      issues.push(`Dimension weight "${key}" is ${val}, must be 0-100`);
    }
  }

  // ── Design brief ──────────────────────────────────────────────────
  const wordCount = result.design_brief.trim().split(/\s+/).length;
  if (wordCount > 50) {
    issues.push(`Design brief is ${wordCount} words (max 50)`);
  }

  if (issues.length > 0) {
    throw new JobSpecQualityError(issues);
  }
}

// ── Parser with provider fallback ───────────────────────────────────

const JOB_SPEC_MAX_TOKENS = 4096;

function getHttpStatus(err: unknown): number | undefined {
  const status = (err as { status?: number }).status;
  return typeof status === "number" ? status : undefined;
}

async function callProviderForJobSpec(
  providerName: ProviderName,
  prompt: string
): Promise<{ output: JobSpecResult; modelId: string; usage: TokenUsage }> {
  const modelId = getModelId(providerName);
  const factory = getProviderFactory(providerName);
  const model = factory(modelId);

  const result = await generateText({
    model,
    system: JOB_SPEC_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: JOB_SPEC_MAX_TOKENS,
    output: Output.object({ schema: JobSpecResultSchema }),
  });

  if (result.output === null) {
    throw new Error(
      "AI response did not match expected schema (validation failed)"
    );
  }

  const output = result.output as JobSpecResult;
  validateQuality(output);

  return { output, modelId, usage: extractUsage(result.usage) };
}

export async function parseJobSpec(
  extractedText: string,
  clientName: string
): Promise<{ output: JobSpecResult; providerName: ProviderName; modelId: string; usage: TokenUsage }> {
  const chain = getProviderChain();
  const prompt = buildJobSpecPrompt(extractedText, clientName);
  const attempts: ProviderAttempt[] = [];

  for (const providerName of chain) {
    try {
      const result = await callProviderForJobSpec(providerName, prompt);
      return { ...result, providerName };
    } catch (err: unknown) {
      const status = getHttpStatus(err);
      const message = err instanceof Error ? err.message : String(err);

      const isRetryable =
        (status !== undefined && status >= 500) ||
        message.includes("validation failed") ||
        err instanceof JobSpecQualityError;

      if (isRetryable) {
        console.warn(
          `AI job-spec: ${providerName} failed (${status ?? "validation/quality"}), retrying once...`
        );
        try {
          const result = await callProviderForJobSpec(providerName, prompt);
          return { ...result, providerName };
        } catch (retryErr: unknown) {
          const retryMessage =
            retryErr instanceof Error ? retryErr.message : String(retryErr);
          attempts.push({
            provider: providerName,
            error: retryMessage,
            timestamp: new Date().toISOString(),
            httpStatus: getHttpStatus(retryErr),
          });
          console.warn(
            `AI job-spec: ${providerName} failed on retry, moving to next provider`
          );
        }
      } else {
        attempts.push({
          provider: providerName,
          error: message,
          timestamp: new Date().toISOString(),
          httpStatus: status,
        });
        console.warn(
          `AI job-spec: ${providerName} failed (${status ?? "error"}), moving to next provider`
        );
      }
    }
  }

  throw new AllProvidersFailedError(attempts);
}
