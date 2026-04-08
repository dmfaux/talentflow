import { generateText, Output, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type ProviderName,
  type ScoringResult,
  ScoringResultSchema,
  getProviderChain,
  getModelId,
  MAX_TOKENS,
} from "./config";

// ── Provider singletons ─────────────────────────────────────────────

type ProviderFactory = (modelId: string) => LanguageModel;

const singletons: Partial<Record<ProviderName, ProviderFactory>> = {};

function getProviderFactory(name: ProviderName): ProviderFactory {
  if (!singletons[name]) {
    singletons[name] = createProviderFactory(name);
  }
  return singletons[name];
}

function createProviderFactory(name: ProviderName): ProviderFactory {
  switch (name) {
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return (modelId: string) => provider(modelId);
    }
    case "openai": {
      const provider = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return (modelId: string) => provider(modelId);
    }
    case "openrouter": {
      const provider = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY || "",
        headers: {
          ...(process.env.OPENROUTER_SITE_URL && {
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL,
          }),
          ...(process.env.OPENROUTER_SITE_NAME && {
            "X-Title": process.env.OPENROUTER_SITE_NAME,
          }),
        },
      });
      return (modelId: string) => provider(modelId);
    }
    case "local": {
      const provider = createOpenAICompatible({
        name: "local",
        baseURL: process.env.AI_LOCAL_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.AI_LOCAL_API_KEY || "not-needed",
      });
      return (modelId: string) => provider(modelId);
    }
  }
}

// ── Types ────────────────────────────────────────────────────────────

export interface ProviderAttempt {
  provider: ProviderName;
  error: string;
  timestamp: string;
  httpStatus?: number;
}

export interface AIResult {
  output: ScoringResult;
  text: string;
  providerName: ProviderName;
  modelId: string;
  attempts: ProviderAttempt[];
}

export class AllProvidersFailedError extends Error {
  constructor(public attempts: ProviderAttempt[]) {
    const summary = attempts
      .map((a) => `${a.provider}: ${a.error}`)
      .join("; ");
    super(`All AI providers failed: ${summary}`);
    this.name = "AllProvidersFailedError";
  }
}

// ── Fallback chain ──────────────────────────────────────────────────

function getHttpStatus(err: unknown): number | undefined {
  const status = (err as { status?: number }).status;
  return typeof status === "number" ? status : undefined;
}

async function callProvider(
  providerName: ProviderName,
  system: string,
  prompt: string
): Promise<{ output: ScoringResult; text: string; modelId: string }> {
  const modelId = getModelId(providerName);
  const factory = getProviderFactory(providerName);
  const model = factory(modelId);

  const result = await generateText({
    model,
    system,
    prompt,
    maxOutputTokens: MAX_TOKENS,
    output: Output.object({ schema: ScoringResultSchema }),
  });

  if (result.output === null) {
    throw new Error(
      "AI response did not match expected schema (validation failed)"
    );
  }

  return {
    output: result.output as ScoringResult,
    text: result.text,
    modelId,
  };
}

export async function callWithFallback(
  system: string,
  prompt: string
): Promise<AIResult> {
  const chain = getProviderChain();
  const attempts: ProviderAttempt[] = [];

  for (const providerName of chain) {
    // First attempt
    try {
      const result = await callProvider(providerName, system, prompt);
      return { ...result, providerName, attempts };
    } catch (err: unknown) {
      const status = getHttpStatus(err);
      const message = err instanceof Error ? err.message : String(err);

      // Retry once on 5xx or schema validation failure
      const isRetryable =
        (status !== undefined && status >= 500) ||
        message.includes("validation failed");

      if (isRetryable) {
        console.warn(
          `AI: ${providerName} failed (${status ?? "validation"}), retrying once...`
        );
        try {
          const result = await callProvider(providerName, system, prompt);
          return { ...result, providerName, attempts };
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
            `AI: ${providerName} failed on retry, moving to next provider`
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
          `AI: ${providerName} failed (${status ?? "error"}), moving to next provider`
        );
      }
    }
  }

  throw new AllProvidersFailedError(attempts);
}
