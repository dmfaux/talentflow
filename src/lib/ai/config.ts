import { z } from "zod";

// ── Provider types ──────────────────────────────────────────────────

export type ProviderName = "anthropic" | "openai" | "openrouter" | "local";

const VALID_PROVIDERS = new Set<ProviderName>([
  "anthropic",
  "openai",
  "openrouter",
  "local",
]);

// ── Provider chain ──────────────────────────────────────────────────

export function getProviderChain(): ProviderName[] {
  const raw = process.env.AI_PROVIDERS || "anthropic";
  const names = raw.split(",").map((s) => s.trim().toLowerCase());

  const chain: ProviderName[] = [];
  for (const name of names) {
    if (!VALID_PROVIDERS.has(name as ProviderName)) {
      console.warn(`AI config: ignoring unknown provider "${name}"`);
      continue;
    }
    chain.push(name as ProviderName);
  }

  if (chain.length === 0) {
    throw new Error(
      `AI config: no valid providers in AI_PROVIDERS="${raw}". Valid options: ${[...VALID_PROVIDERS].join(", ")}`
    );
  }

  return chain;
}

// ── Model selection ─────────────────────────────────────────────────

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  openrouter: "anthropic/claude-sonnet-4-6",
  local: "default",
};

export function getModelId(provider: ProviderName): string {
  switch (provider) {
    case "anthropic":
      return process.env.AI_ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
    case "openai":
      return process.env.AI_OPENAI_MODEL || DEFAULT_MODELS.openai;
    case "openrouter":
      return process.env.AI_OPENROUTER_MODEL || DEFAULT_MODELS.openrouter;
    case "local":
      return process.env.AI_LOCAL_MODEL || DEFAULT_MODELS.local;
  }
}

// ── Constants ───────────────────────────────────────────────────────

export const MAX_TOKENS = 1024;

export const SYSTEM_PROMPT = `You are an expert recruitment assessor. You evaluate candidate CVs against specific job requirements with precision and objectivity.

You MUST respond with a single valid JSON object matching the exact schema specified. Do not include any text outside the JSON object. Do not wrap it in markdown code fences.`;

export const RESCORE_SYSTEM_PROMPT = `You are an expert recruitment assessor performing a secondary evaluation. You have access to the candidate's CV, screening answers, an initial AI assessment, and a follow-up chat transcript. Your task is to produce an updated, more informed score.

Be sceptical of chat responses — candidates naturally present themselves in the best possible light. Focus on the specificity and verifiability of their claims rather than eloquence or enthusiasm.

You MUST respond with a single valid JSON object matching the exact schema specified. Do not include any text outside the JSON object. Do not wrap it in markdown code fences.`;

// ── Scoring result schema ───────────────────────────────────────────

export const ScoringResultSchema = z.object({
  overall_score: z.number(),
  dimensions: z.object({
    skills_match: z.number(),
    experience_depth: z.number(),
    career_progression: z.number(),
    tenure_patterns: z.number(),
  }),
  confidence: z.enum(["high", "medium", "low"]),
  rationale: z.string(),
  flags: z.array(z.string()),
  recommendation: z.enum([
    "strong_recommend",
    "recommend",
    "recommend_with_caveats",
    "borderline",
    "reject",
  ]),
});

export type ScoringResult = z.infer<typeof ScoringResultSchema>;
