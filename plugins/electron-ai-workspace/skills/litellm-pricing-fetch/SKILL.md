---
name: litellm-pricing-fetch
description: Use when an app needs per-token model pricing (cost UI, billing forecasts, token-budget enforcement) for OpenAI / Anthropic / Gemini / Bedrock / Vertex / etc. Loads a bundled pricing snapshot at startup, refreshes it from LiteLLM's `model_prices_and_context_window.json` in the background, and falls back to bundled if the network is unreachable. Includes a `scripts/sync-model-pricing.js` that re-bundles the snapshot at build time.
---

# litellm-pricing-fetch

Pricing-as-a-data-file. The pattern:

1. **Bundled snapshot** ships with the app (`src/main/ai/pricing/bundled-pricing.ts`) — slim copy of LiteLLM's pricing JSON, keeping only the modes and fields the app uses.
2. **Background refresh** at startup tries to pull the live file with an 8s timeout. On success, writes to `userData/model-pricing.json` for the next launch and updates the in-memory snapshot.
3. **Cache load** at startup reads `userData/model-pricing.json` first; only uses it if its `fetched_at` is newer than the bundled snapshot's. Belt-and-braces — the cache might be from yesterday, the bundle might be from a fresh release.
4. **Build-time sync script** (`scripts/sync-model-pricing.js`) regenerates the bundled snapshot before a release so a fresh install ships with current pricing.

## When to use

- App displays per-call cost (chat UI cost badge, billing dashboard, etc.).
- App enforces token budgets and needs to reason about $ cost as well as token count.
- You want pricing for Bedrock/Vertex mirrors of Anthropic/Gemini models too — LiteLLM's source covers them with normalised id forms.

## What it scaffolds

| Source | Destination |
|---|---|
| `templates/src/main/ai/pricing.ts` | `src/main/ai/pricing.ts` — `initPricing`, `lookupPricing`, `lookupBatch`, `getActiveSnapshot` |
| `templates/src/main/ai/pricing/bundled-pricing.ts` | `src/main/ai/pricing/bundled-pricing.ts` — placeholder; run the sync script to populate |
| `templates/scripts/sync-model-pricing.js` | `scripts/sync-model-pricing.js` — fetches LiteLLM, slims, writes the TS module |

After dropping in the templates, run `node scripts/sync-model-pricing.js` once to populate the bundle. Re-run before each release.

## Decision points

- **Modes to keep** — defaults: `chat`, `completion`, `responses`, `embedding`. If you also do image/audio models, add those mode strings.
- **Fields to keep** — defaults: input/output cost, cache read/write costs, max input/output tokens, provider tag, mode. Add anything else LiteLLM tracks that you actually use; missing fields aren't free — bundle size grows linearly.
- **Cache filename** — defaults to `model-pricing.json` under `userData`. Don't put it under `userData/pricing/` — that conflicts with the source dir name in some build setups.
- **Refresh timeout** — defaults to 8s. Long enough to succeed on a slow connection, short enough not to delay startup if the network is dead.

## Why a `.ts` bundle, not a `.json`?

`tsup` with `bundle: false` (the per-file config from `electron-express-react-router` in the `electron-desktop` plugin) doesn't copy `.json` files into `dist/`. They'd 404 at runtime in production builds. Wrapping the snapshot as a TS export sidesteps the bundler problem — `import { BUNDLED_PRICING } from './pricing/bundled-pricing.js'` works in dev and prod.

The trade-off is build size: a 200KB JSON becomes a 200KB string in a TS file. Acceptable for desktop apps; would be a problem for browser bundles.

## Lookup strategy: normalisation candidates

`lookupPricing(modelId)` tries a chain of candidate ids before giving up:

1. The id verbatim.
2. The id with a trailing `-YYYYMMDD` (8-digit) date stripped.
3. The id with a trailing `-YYYY-MM-DD` (10-digit) date stripped.
4. Each of the above prefixed with `anthropic.`, `global.anthropic.`, or `vertex_ai/` (for Bedrock and Vertex mirrors).

Then the same candidates are tried again ignoring the provider-tag check. The two-pass approach prefers a "this id matches *and* the provider tag matches" hit over a "this id matches but the entry is for a different provider" hit. Bedrock-mirrored Claude pricing should be reachable both as `claude-opus-4-7` and `anthropic.claude-opus-4-7`.

## In-app usage

```typescript
import { initPricing, lookupPricing } from "./ai/pricing.js";

// In server.ts createServer():
initPricing();  // never throws; non-blocking

// In a chat route's onFinish handler:
const pricing = lookupPricing(modelId);
if (pricing) {
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTokens;
  // persist cost on the message metadata
}
```

## Source

Lifted from:
- [trident/src/main/ai/pricing.ts](https://github.com/eastechs/trident/blob/main/src/main/ai/pricing.ts)
- [trident/scripts/sync-model-pricing.js](https://github.com/eastechs/trident/blob/main/scripts/sync-model-pricing.js)
