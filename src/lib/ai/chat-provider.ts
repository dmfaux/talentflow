import type { LanguageModel } from "ai";
import { getProviderChain, getModelId } from "./config";
import { resolveModelForTier } from "./resolve-tier";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderName } from "./config";

/** Chat is hard-pinned to the Essential tier — both the model actually run and
 *  the billed rate (owner's decision; docs/pricing-model.md). For Anthropic (the
 *  canonical chat provider) that's the Essential model id; a non-Anthropic head
 *  provider keeps its env model but chat usage is still billed at the Essential
 *  rate (tier = intent, not which provider answered). */
function chatModelId(providerName: ProviderName): string {
  return providerName === "anthropic"
    ? resolveModelForTier("essential", "chat").model
    : getModelId(providerName);
}

export function getChatModel(): LanguageModel {
  const providerName = getProviderChain()[0];
  return createModel(providerName, chatModelId(providerName));
}

/** Provider + model id backing getChatModel(), for usage attribution (S10).
 *  Resolved the same way (chain head + Essential pin) so it matches the model
 *  actually used. */
export function getChatModelMeta(): { providerName: ProviderName; modelId: string } {
  const providerName = getProviderChain()[0];
  return { providerName, modelId: chatModelId(providerName) };
}

function createModel(name: ProviderName, modelId: string): LanguageModel {
  switch (name) {
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return provider(modelId);
    }
    case "openai": {
      const provider = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return provider(modelId);
    }
    case "openrouter": {
      const provider = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY || "",
      });
      return provider(modelId);
    }
    case "local": {
      const provider = createOpenAICompatible({
        name: "local",
        baseURL: process.env.AI_LOCAL_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.AI_LOCAL_API_KEY || "not-needed",
      });
      return provider(modelId);
    }
  }
}
