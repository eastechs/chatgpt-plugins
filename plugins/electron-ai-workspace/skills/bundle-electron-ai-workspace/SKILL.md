---
name: bundle-electron-ai-workspace
description: Use when an Electron desktop app already has the base stack from the electron-desktop plugin (or an equivalent server + database + auth + settings stack) and needs the full AI workspace layer — multi-provider routing, LiteLLM pricing, pgvector semantic search, and UIMessage-native chat persistence. Composes the vercel-ai-multi-provider, litellm-pricing-fetch, pglite-pgvector-embeddings, and ai-sdk-uimessage-persistence skills in order.
---

# bundle-electron-ai-workspace

The AI layer that turns a base desktop app into an AI workspace. It sits on top of `bundle-electron-trident-stack` from the `electron-desktop` plugin (or a hand-rolled equivalent) and assumes the database, settings store, server, and auth are already in place.

## When to use

- App already has the `electron-desktop` plugin's `bundle-electron-trident-stack` applied (or the underlying `electron-express-react-router` + `electron-pglite-drizzle` + `electron-loopback-server-auth` + `electron-encrypted-settings` capabilities wired independently).
- You want all of: multi-provider chat with reasoning, cost tracking, RAG over user docs, persistent conversations.
- You're building an "AI assistant for your X" — chat with documents, generate things, search semantically.

If you only need a subset (e.g. chat without RAG), invoke individual skills directly.

## Prerequisites

This bundle assumes the following skills from the `electron-desktop` plugin are already wired:

- **PGLite + Drizzle** (`electron-pglite-drizzle`) — the migration runner is in place; `getDb()` works; `_migrations` table tracks applied migrations.
- **Encrypted settings** (`electron-encrypted-settings`) — `getApiKey("anthropic" | "openai" | "gemini")` returns a string or undefined; encryption-availability gate is enforced.
- **Express server** (`electron-express-react-router`) — routes are mounted via `app.use("/api/...", router)`; `requireServerAuth` middleware (from `electron-loopback-server-auth`) is on `/api`.

If any are missing, install the `electron-desktop` plugin and apply `bundle-electron-trident-stack` first, then come back here.

## Composition order

1. **[vercel-ai-multi-provider](../vercel-ai-multi-provider/SKILL.md)** — `providers.ts`, `model-registry.ts`, `validate-key.ts`. Ties in with `getApiKey` from `electron-encrypted-settings` in the `electron-desktop` plugin. Adds `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `ai` deps.
2. **[litellm-pricing-fetch](../litellm-pricing-fetch/SKILL.md)** — `pricing.ts`, `bundled-pricing.ts`, `scripts/sync-model-pricing.js`. Run the sync script once to populate the snapshot. Add `initPricing()` to `createServer()` in `src/main/server.ts`.
3. **[pglite-pgvector-embeddings](../pglite-pgvector-embeddings/SKILL.md)** — adds migration 002 (vector extension + `document_chunks` table) and `embeddings.ts`. Depends on `electron-pglite-drizzle`'s migrations array and on a `documents` table existing — if your app stores arbitrary text rather than "documents", rename the table to match.
4. **[ai-sdk-uimessage-persistence](../ai-sdk-uimessage-persistence/SKILL.md)** — adds `conversations` and `messages` tables (via a new migration entry), and `routes/chat.ts`. Depends on `vercel-ai-multi-provider` (provider resolution) and `electron-pglite-drizzle` (database).

Order matters: `ai-sdk-uimessage-persistence` imports from `vercel-ai-multi-provider`; `pglite-pgvector-embeddings` imports from `electron-pglite-drizzle` + `electron-encrypted-settings`; `litellm-pricing-fetch` plugs in independently but feeds the provider skill's pricing display path.

## Shared decisions to make up-front

| Decision | Used by | Default |
|---|---|---|
| **Default model** for new conversations | vercel-ai-multi-provider, ai-sdk-uimessage-persistence | `claude-sonnet-4-6` |
| **Default effort level** for new conversations | vercel-ai-multi-provider, ai-sdk-uimessage-persistence | `medium` |
| **Embedding model** + dimension | pglite-pgvector-embeddings | `text-embedding-3-small` (1536 dims) |
| **Min similarity floor** | pglite-pgvector-embeddings | `0.3` |
| **Pricing modes to keep** | litellm-pricing-fetch | chat, completion, responses, embedding |
| **Token cap per chunk** | pglite-pgvector-embeddings | 512 |
| **Step count limit** for `streamText` | ai-sdk-uimessage-persistence | 25 |

## After-bundle wiring

`src/main/server.ts` gets new imports + the pricing init:

```typescript
import { initPricing } from "./ai/pricing.js";
import chatRoutes from "./routes/chat.js";

export async function createServer(port: number): Promise<void> {
  initPricing();  // non-blocking; never throws
  // ...
  app.use("/api/projects/:projectId/chat", chatRoutes);
}
```

`src/main/db/migrations.ts` array extends with two new entries (in order):

```typescript
const MIGRATIONS = [
  { id: "001_initial", ... },           // from electron-pglite-drizzle
  { id: "001_chat_tables", ... },       // from ai-sdk-uimessage-persistence — rename to 002 if it conflicts
  { id: "002_embeddings", ... },        // from pglite-pgvector-embeddings — renumber as needed
];
```

Renumber as needed so the chat tables migration runs *before* anything that references conversation/message ids, and the embeddings migration runs *after* whichever migration creates `documents`.

The renderer needs a documents/conversation API + a `useChat` host. Those are app-specific UI; they aren't templated here. The server side gives you the endpoints to wire to.

## End-to-end verification

After all four skills are in place:

1. **Pricing**: `node scripts/sync-model-pricing.js` — should produce a populated `bundled-pricing.ts`.
2. **Provider routing**: with at least one API key configured, `resolveModel("claude-sonnet-4-6")` (or the equivalent) should return a `LanguageModel`. With no key configured it should throw a clean "API key not configured" error.
3. **Key validation**: `validateApiKey("openai", "sk-bogus")` should return false (within the 10s timeout); a real key should return true.
4. **Embeddings**: create a project and document via your app's API, embed it, then `searchProject(projectId, "some keyword from the doc")` should return the doc with a score above 0.3. Searching for unrelated text should return an empty array (not low-score noise).
5. **Chat round-trip**: post a UIMessage to `/api/projects/:id/chat`, stream completes, message appears in `messages` table with parts JSONB matching what the client sent. Reload and `GET /api/projects/:id/chat/messages?conversation_id=...` returns the same shape.
6. **Anthropic cache**: send two consecutive messages on Claude with the same system + tools; second turn's metadata should report `cache_read_input_tokens > 0`.
7. **Abort**: start a long generation, kill the request mid-stream; the provider should stop billing tokens (verify by tailing `streamText`'s onFinish — `isAborted: true`).

## What this bundle leaves out

- **No image generation / image embeddings** — easy to add by extending the `pglite-pgvector-embeddings` pattern, but the trident original ties images to a specific schema this bundle doesn't carry.
- **No web search tool wiring** — present in trident's chat.ts but project-specific. Add as a one-off if needed (`ai-sdk-uimessage-persistence`'s SKILL.md shows the pattern).
- **No agent tool framework** — `createTools()` in trident is its workspace tools (ListDirectory/ReadFile/SearchFiles, EditDocument, etc.). Those are too app-specific to template; build your own tool set on top.

## Source

This bundle is the "AI layer" half of trident's skill-suggestions. The base stack is `bundle-electron-trident-stack` in the `electron-desktop` plugin.
