import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { BUNDLED_PRICING } from "./pricing/bundled-pricing.js";

// Per-million-token rates used everywhere in the UI cost calc. The LiteLLM
// source file is per-token, so we multiply by 1e6 in `toPricing` below.
export interface ModelPricing {
  inputPerMTokens: number;
  outputPerMTokens: number;
  cacheReadPerMTokens?: number;
  cacheWritePerMTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RawEntry {
  litellm_provider?: string;
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
}

export interface RawPricingData {
  source: string;
  fetched_at: string;
  models: Record<string, RawEntry>;
}

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const REFRESH_TIMEOUT_MS = 8_000;
const KEEP_MODES = new Set(["chat", "completion", "responses", "embedding"]);
const KEEP_FIELDS: (keyof RawEntry)[] = [
  "litellm_provider",
  "mode",
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_read_input_token_cost",
  "cache_creation_input_token_cost",
  "max_input_tokens",
  "max_output_tokens",
];

let activeData: RawPricingData = BUNDLED_PRICING;

function getCachePath(): string {
  return path.join(app.getPath("userData"), "model-pricing.json");
}

// Background-load any cached refresh from a prior session, then kick off a
// new fetch. Never throws — pricing always falls back to the bundled
// snapshot. Call once during app startup.
export function initPricing(): void {
  void (async () => {
    try {
      const text = await fs.readFile(getCachePath(), "utf-8");
      const cached = JSON.parse(text) as RawPricingData;
      if (
        cached?.fetched_at &&
        new Date(cached.fetched_at) > new Date(activeData.fetched_at)
      ) {
        activeData = cached;
        console.log(
          `[pricing] Loaded cached snapshot (${Object.keys(activeData.models).length} models, fetched ${activeData.fetched_at})`,
        );
      }
    } catch {
      // No cache yet, or unreadable — fine.
    }
    void refreshPricing();
  })();
}

async function refreshPricing(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(SOURCE_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`[pricing] Refresh fetch returned ${res.status}`);
      return;
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const slim: RawPricingData = {
      source: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      models: {},
    };
    for (const [key, value] of Object.entries(raw)) {
      if (key === "sample_spec" || !value || typeof value !== "object")
        continue;
      const entry = value as Record<string, unknown>;
      const mode = entry.mode as string | undefined;
      if (mode && !KEEP_MODES.has(mode)) continue;
      const slimEntry: RawEntry = {};
      for (const field of KEEP_FIELDS) {
        const v = entry[field];
        if (v !== undefined && v !== null) {
          (slimEntry as Record<string, unknown>)[field] = v;
        }
      }
      if (Object.keys(slimEntry).length > 0) slim.models[key] = slimEntry;
    }
    activeData = slim;
    await fs.writeFile(getCachePath(), JSON.stringify(slim));
    console.log(
      `[pricing] Refreshed ${Object.keys(slim.models).length} model entries from LiteLLM`,
    );
  } catch (err) {
    console.warn("[pricing] Background refresh failed:", err);
  }
}

// Lookup with normalization. Tries exact match first, then dated-suffix-
// stripped variants, then provider-prefixed forms (Bedrock/Vertex mirrors
// carry the same canonical pricing as the direct provider entries).
export function lookupPricing(modelId: string): ModelPricing | undefined {
  const expectedProvider = guessProvider(modelId);
  const candidates = generateCandidates(modelId);

  for (const candidate of candidates) {
    const entry = activeData.models[candidate];
    if (!entry) continue;
    if (expectedProvider && entry.litellm_provider === expectedProvider) {
      return toPricing(entry);
    }
  }
  for (const candidate of candidates) {
    const entry = activeData.models[candidate];
    if (entry) return toPricing(entry);
  }
  return undefined;
}

export function lookupBatch(modelIds: string[]): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {};
  for (const id of modelIds) {
    const p = lookupPricing(id);
    if (p) out[id] = p;
  }
  return out;
}

export function getActiveSnapshot(): {
  source: string;
  fetched_at: string;
  modelCount: number;
} {
  return {
    source: activeData.source,
    fetched_at: activeData.fetched_at,
    modelCount: Object.keys(activeData.models).length,
  };
}

function guessProvider(modelId: string): string | undefined {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "gemini";
  if (modelId.startsWith("text-embedding-")) return "openai";
  if (/^(gpt-|o\d)/.test(modelId)) return "openai";
  return undefined;
}

function generateCandidates(modelId: string): string[] {
  const set = new Set<string>();
  set.add(modelId);
  const dateStripped8 = modelId.replace(/-\d{8}$/, "");
  const dateStripped10 = modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  set.add(dateStripped8);
  set.add(dateStripped10);
  // Bedrock/Vertex variants — same canonical pricing as direct provider entries.
  for (const base of [modelId, dateStripped8, dateStripped10]) {
    set.add(`anthropic.${base}`);
    set.add(`global.anthropic.${base}`);
    set.add(`vertex_ai/${base}`);
  }
  set.delete("");
  return Array.from(set);
}

function toPricing(entry: RawEntry): ModelPricing {
  const perM = (n: number | undefined): number => (n ?? 0) * 1_000_000;
  const result: ModelPricing = {
    inputPerMTokens: perM(entry.input_cost_per_token),
    outputPerMTokens: perM(entry.output_cost_per_token),
  };
  if (entry.cache_read_input_token_cost != null) {
    result.cacheReadPerMTokens = perM(entry.cache_read_input_token_cost);
  }
  if (entry.cache_creation_input_token_cost != null) {
    result.cacheWritePerMTokens = perM(entry.cache_creation_input_token_cost);
  }
  if (entry.max_input_tokens) result.contextWindow = entry.max_input_tokens;
  if (entry.max_output_tokens) result.maxOutputTokens = entry.max_output_tokens;
  return result;
}
