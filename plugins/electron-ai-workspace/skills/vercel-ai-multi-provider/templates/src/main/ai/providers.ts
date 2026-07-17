import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { getApiKey } from "../settings.js";
import { supportsReasoning } from "./model-registry.js";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const DEFAULT_EFFORT: EffortLevel = "medium";

export function isEffortLevel(value: unknown): value is EffortLevel {
  return (
    typeof value === "string" &&
    (EFFORT_LEVELS as readonly string[]).includes(value)
  );
}

export type ProviderName = "anthropic" | "openai" | "gemini";

export function resolveProviderName(modelId: string): ProviderName {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "gemini";
  return "openai";
}

export { displayNameFor as modelLabel } from "./model-registry.js";

export function resolveModel(modelId: string): LanguageModel {
  const provider = resolveProviderName(modelId);

  if (provider === "anthropic") {
    const key = getApiKey("anthropic");
    if (!key) throw new Error("Anthropic API key not configured");
    return createAnthropic({ apiKey: key })(modelId);
  }

  if (provider === "gemini") {
    const key = getApiKey("gemini");
    if (!key) throw new Error("Gemini API key not configured");
    return createGoogleGenerativeAI({ apiKey: key })(modelId);
  }

  const key = getApiKey("openai");
  if (!key) throw new Error("OpenAI API key not configured");
  return createOpenAI({ apiKey: key })(modelId);
}

/**
 * Map a unified effort level to each provider's native value range.
 *
 *   - Anthropic:  low | medium | high | xhigh | max   (full set, passes through)
 *   - OpenAI:     low | medium | high | xhigh         (no 'max'; clamp down)
 *   - Gemini:     low | medium | high                 (no 'xhigh' or 'max'; clamp down)
 *
 * 'max' and 'xhigh' clamp to the highest available rung where unsupported.
 */
function effortToOpenAI(
  level: EffortLevel,
): "low" | "medium" | "high" | "xhigh" {
  return level === "max" ? "xhigh" : level;
}

function effortToGemini(level: EffortLevel): "low" | "medium" | "high" {
  if (level === "max" || level === "xhigh") return "high";
  return level;
}

/**
 * Per-provider options applied to every chat call.
 *
 *   - Anthropic: extended thinking with adaptive budget + summarized display;
 *                contextManagement.clear_tool_uses_20250919 drops old tool-use
 *                blocks when input tokens exceed 100k, keeping the last 20.
 *   - OpenAI:    auto reasoning summaries; truncation 'auto' so the Responses
 *                API drops oldest turns instead of failing when the prompt
 *                nears the model's context limit; promptCacheRetention '24h'
 *                (max) for stickier auto-caching; promptCacheKey scoped per
 *                project so requests in the same project route to the same
 *                cache instance.
 *   - Gemini:    thinkingConfig with summaries, level dialed per conversation.
 */
export function getProviderOptions(
  modelId: string,
  context?: { projectId?: string; effort?: EffortLevel },
): ProviderOptions {
  const provider = resolveProviderName(modelId);
  const effort = context?.effort ?? DEFAULT_EFFORT;

  if (provider === "anthropic") {
    const reasoningOk = supportsReasoning(modelId, "anthropic");
    return {
      anthropic: {
        // Skip the thinking block + effort knob on chat-only Claude models
        // (e.g. claude-3-5-*) so the API doesn't reject the request.
        ...(reasoningOk
          ? {
              thinking: { type: "adaptive", display: "summarized" },
              effort,
            }
          : {}),
        sendReasoning: true,
        contextManagement: {
          edits: [
            {
              type: "clear_tool_uses_20250919",
              trigger: { type: "input_tokens", value: 100_000 },
              keep: { type: "tool_uses", value: 20 },
            },
          ],
        },
      },
    };
  }

  if (provider === "openai") {
    const reasoningOk = supportsReasoning(modelId, "openai");
    return {
      openai: {
        // reasoningEffort is only valid on the o-series and gpt-5 family;
        // sending it to gpt-4o or chat-only models 4xxs.
        ...(reasoningOk
          ? {
              reasoningEffort: effortToOpenAI(effort),
              reasoningSummary: "auto",
            }
          : {}),
        truncation: "auto",
        promptCacheRetention: "24h",
        ...(context?.projectId ? { promptCacheKey: context.projectId } : {}),
      },
    };
  }

  if (provider === "gemini") {
    if (!supportsReasoning(modelId, "google")) return {};
    return {
      google: {
        thinkingConfig: {
          thinkingLevel: effortToGemini(effort),
          includeThoughts: true,
        },
      },
    };
  }

  return {};
}
