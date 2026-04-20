import { getDecryptedKey } from "@/encryptionService";
import { getSettings } from "@/settings/model";
import type { Api, Model } from "@mariozechner/pi-ai";

const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Resolve the configured pi model into a concrete pi-ai model object.
 */
export function resolvePiModel(): Model<Api> {
  const settings = getSettings();
  const { apiMode, provider, baseUrl, modelId } = settings.piAgent;

  if (!baseUrl.trim() || !modelId.trim()) {
    throw new Error(
      "Pi agent is not fully configured. Set the base URL and model ID in Settings > Basic > Agent Backend."
    );
  }

  return {
    id: modelId.trim(),
    name: modelId.trim(),
    api: apiMode,
    provider: provider.trim() || "openai",
    baseUrl: baseUrl.trim(),
    reasoning: settings.piAgent.thinkingLevel !== "minimal",
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: settings.maxTokens,
    ...(apiMode === "openai-completions"
      ? {
          compat: {
            supportsReasoningEffort: true,
            supportsUsageInStreaming: true,
          },
        }
      : {}),
  };
}

/**
 * Resolve the decrypted API key for the pi backend.
 */
export async function resolvePiApiKey(): Promise<string> {
  const apiKey = await getDecryptedKey(getSettings().piAgent.apiKey);
  if (!apiKey.trim()) {
    throw new Error(
      "Pi agent API key is empty. Set it in Settings > Basic > Agent Backend before using the pi backend."
    );
  }
  return apiKey.trim();
}
