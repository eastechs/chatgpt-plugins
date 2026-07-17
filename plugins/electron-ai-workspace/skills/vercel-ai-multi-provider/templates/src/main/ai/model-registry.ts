// REPLACE: refresh as new models drop. The registry's only two jobs:
//   1. Tell the providers.ts router whether a model supports reasoning
//      (skip thinking/reasoningEffort options on chat-only models).
//   2. Provide a display name for the UI. Falls back to the raw id.

type ProviderTag = "anthropic" | "openai" | "google";

interface ModelMeta {
  displayName: string;
  reasoning: boolean;
}

const MODELS: Record<string, ModelMeta> = {
  // Anthropic — reasoning starts at Claude 3.7
  "claude-opus-4-7": { displayName: "Claude Opus 4.7", reasoning: true },
  "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6", reasoning: true },
  "claude-haiku-4-5-20251001": {
    displayName: "Claude Haiku 4.5",
    reasoning: true,
  },
  "claude-3-5-sonnet-20241022": {
    displayName: "Claude 3.5 Sonnet",
    reasoning: false,
  },
  "claude-3-5-haiku-20241022": {
    displayName: "Claude 3.5 Haiku",
    reasoning: false,
  },

  // OpenAI — reasoning on o-series and gpt-5 family
  "o3-mini": { displayName: "o3 mini", reasoning: true },
  o3: { displayName: "o3", reasoning: true },
  "gpt-5": { displayName: "GPT-5", reasoning: true },
  "gpt-4o": { displayName: "GPT-4o", reasoning: false },
  "gpt-4o-mini": { displayName: "GPT-4o mini", reasoning: false },

  // Gemini — reasoning on 2.5 Pro/Flash
  "gemini-2.5-pro": { displayName: "Gemini 2.5 Pro", reasoning: true },
  "gemini-2.5-flash": { displayName: "Gemini 2.5 Flash", reasoning: true },
  "gemini-2.0-flash": { displayName: "Gemini 2.0 Flash", reasoning: false },
};

export function supportsReasoning(
  modelId: string,
  _provider: ProviderTag,
): boolean {
  // Strip dated suffix (`-20251001`) before lookup so dated variants share
  // the meta of their canonical id.
  const base = modelId.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return MODELS[modelId]?.reasoning ?? MODELS[base]?.reasoning ?? false;
}

export function displayNameFor(modelId: string): string {
  const base = modelId.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return MODELS[modelId]?.displayName ?? MODELS[base]?.displayName ?? modelId;
}
