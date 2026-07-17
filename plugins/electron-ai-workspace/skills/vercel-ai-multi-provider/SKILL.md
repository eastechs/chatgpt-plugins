---
name: vercel-ai-multi-provider
description: Use when an app uses the Vercel AI SDK with multiple providers (Anthropic, OpenAI, Gemini) and needs a unified "effort" knob (low/medium/high/xhigh/max) that maps onto each provider's native range. Routes a model id to the right provider by prefix, picks per-provider options (Anthropic context-management edits, OpenAI prompt caching, Gemini thinkingConfig), and refuses requests when the relevant API key isn't configured.
---

# vercel-ai-multi-provider

The provider-routing layer for an AI-SDK app. The hard parts:

1. **Effort range mismatch.** Anthropic supports `low | medium | high | xhigh | max`. OpenAI tops out at `xhigh`. Gemini tops out at `high`. A unified app-side enum has to clamp gracefully.
2. **Per-provider option shapes.** Each provider takes a different `providerOptions` block — Anthropic's `thinking` + `contextManagement`, OpenAI's `reasoningEffort` + `truncation` + `promptCacheRetention`, Gemini's `thinkingConfig`. None are interchangeable.
3. **Reasoning-only models.** Sending `reasoningEffort` to gpt-4o or chat-only Claude returns a 400. The router has to know which models support reasoning.

## When to use

- App uses `streamText` / `generateText` / `embed` from `ai`.
- App lets users pick a model from any of the three big providers (more can be added; the prefix-based router scales linearly).
- API keys live in secure storage (`electron-encrypted-settings` from the `electron-desktop` plugin, or an equivalent settings module) — the resolver pulls them on demand and throws if missing.

## What it scaffolds

| Source | Destination | Purpose |
|---|---|---|
| `templates/src/main/ai/providers.ts` | `src/main/ai/providers.ts` | Prefix router + effort clamping + per-provider options |
| `templates/src/main/ai/model-registry.ts` | `src/main/ai/model-registry.ts` | `supportsReasoning(modelId, provider)` + display-name table |
| `templates/src/main/ai/validate-key.ts` | `src/main/ai/validate-key.ts` | Per-provider key probes (no save until verified) |

## Decision points

- **Provider list** — defaults to Anthropic + OpenAI + Gemini. Add Mistral, Cohere, Bedrock, etc. by extending the prefix table and adding a branch in `resolveModel` / `getProviderOptions`.
- **Default effort** — defaults to `medium`. Sticky per conversation; the chat route reads it off the persisted `conversation.effort` column.
- **Prompt-cache key strategy** — defaults to per-project (`promptCacheKey: projectId`) for OpenAI. Other strategies: per-conversation (sticky cache hit on follow-ups), global (cheapest, but mixes contexts).
- **Anthropic `contextManagement`** — defaults to `clear_tool_uses_20250919` triggered at 100k tokens, keeping the last 20 tool uses. Tune the trigger / keep counts based on your context window.

## The prefix router

```typescript
export function resolveProviderName(modelId: string): ProviderName {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "gemini";
  return "openai";  // gpt-*, o1-*, o3-*, text-embedding-*
}
```

Simple, explicit, easy to extend. Don't get fancy — most model ids start with the provider's family name and stay that way.

## Why effort needs to clamp, not error

Front-end UX: the user picks an effort once on a model picker that shows all five rungs. They keep it as they switch models. If switching from Claude (with `max`) to Gemini errors instead of clamps, the picker has to re-render and reset to a supported value, which feels broken. Clamping silently is the right behaviour:

- `max` on OpenAI → `xhigh`
- `max` or `xhigh` on Gemini → `high`

Document this clearly so the user sees the actual sent value in the UI's "x reasoning effort" badge. Don't hide it — they should know they got `high` not `max` on Gemini.

## Per-provider option choices and why

### Anthropic

```typescript
{
  thinking: { type: "adaptive", display: "summarized" },
  effort,
  sendReasoning: true,
  contextManagement: {
    edits: [{
      type: "clear_tool_uses_20250919",
      trigger: { type: "input_tokens", value: 100_000 },
      keep: { type: "tool_uses", value: 20 },
    }],
  },
}
```

- `thinking: adaptive` — let Claude allocate thinking budget per turn rather than dialling a fixed budget. With `effort` already passed in, Claude scales accordingly.
- `display: summarized` — model emits a summary for the UI; full reasoning still informs the response. Cheaper to render in chat.
- `sendReasoning: true` — round-trip the reasoning blocks so the model can refer back to them on follow-ups.
- `contextManagement` — drop oldest tool-use blocks once input crosses 100k tokens, keep the last 20. Without this, an agent with many file-read calls blows past the context window after ~30 turns.

### OpenAI

```typescript
{
  reasoningEffort: effortToOpenAI(effort),
  reasoningSummary: "auto",
  truncation: "auto",
  promptCacheRetention: "24h",
  promptCacheKey: projectId,
}
```

- `truncation: auto` — Responses API drops oldest turns if the request would exceed the context window, instead of erroring. Keeps long conversations alive.
- `promptCacheRetention: "24h"` — max value. OpenAI's auto-caching only fires on identical-prefix repeats; 24h keeps the cache warm across the user's whole work session.
- `promptCacheKey: projectId` — scopes cache to the project so two projects with similar starting prompts don't poison each other's caches.

### Gemini

```typescript
{
  thinkingConfig: {
    thinkingLevel: effortToGemini(effort),
    includeThoughts: true,
  },
}
```

- `includeThoughts: true` — surfaces thinking summaries to the renderer, same UX as Claude's summarized display.
- `thinkingLevel` — Gemini's term for effort; only three rungs.

## Reasoning-vs-chat split

`supportsReasoning(modelId, provider)` returns true for o-series + gpt-5 (OpenAI), Claude 3.7+ (Anthropic), and Gemini 2.5 Pro/Flash with thinking enabled. For the rest, the per-provider block strips `reasoningEffort` / `thinking` / `thinkingConfig` and just sends the chat options. Sending those keys to a non-reasoning model is a 400 from the API.

The `model-registry.ts` template ships with a starter table; refresh it as new models drop. The `litellm-pricing-fetch` skill provides a similar pattern for pricing — consider building a single "model metadata" module that combines registry + pricing once both are in.

## Per-provider key validation

`validateApiKey(provider, key)` makes a lightweight authenticated request and returns `true` only on a 2xx. Failures, timeouts, and connection errors all return false — refuse to save a key you can't verify. Use this in the onboarding/settings UI:

```typescript
const ok = await validateApiKey("anthropic", trimmedKey);
if (!ok) { showError("Key didn't validate"); return; }
await setApiKey("anthropic", trimmedKey);
```

## Source

Lifted from:
- [trident/src/main/ai/providers.ts](https://github.com/eastechs/trident/blob/main/src/main/ai/providers.ts)
- [trident/src/main/ai/model-registry.ts](https://github.com/eastechs/trident/blob/main/src/main/ai/model-registry.ts)
- [trident/src/main/ai/validate-key.ts](https://github.com/eastechs/trident/blob/main/src/main/ai/validate-key.ts)
