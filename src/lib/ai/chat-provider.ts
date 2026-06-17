import type { LanguageModel } from "ai";
import { getProviderChain, getModelId } from "./config";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderName } from "./config";

export function getChatModel(): LanguageModel {
  const chain = getProviderChain();
  const providerName = chain[0];
  const modelId = getModelId(providerName);
  return createModel(providerName, modelId);
}

/** Provider + model id backing getChatModel(), for usage attribution (S10).
 *  Resolved the same way (chain head) so it matches the model actually used. */
export function getChatModelMeta(): { providerName: ProviderName; modelId: string } {
  const providerName = getProviderChain()[0];
  return { providerName, modelId: getModelId(providerName) };
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
