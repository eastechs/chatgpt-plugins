---
name: ai-sdk-uimessage-persistence
description: Use when an app uses the Vercel AI SDK's `useChat` (and its `UIMessage` shape with parts) and needs to persist conversations across reloads. Stores `UIMessage.parts` as JSONB directly — no reconstruction, no stitching, the renderer gets back exactly what it sent. Includes the `streamText` route handler with the `onFinish` persistence path, including the "isContinuation" handling for multi-step assistant turns.
---

# ai-sdk-uimessage-persistence

The right shape for persisting Vercel AI SDK conversations: store `UIMessage.parts` directly as a JSONB array. The renderer ships parts; the server stores parts; on reload the renderer gets parts. No format conversion, no stitching tool calls back to text blocks, no shape drift.

## When to use

- App uses `useChat` from `@ai-sdk/react` (the renderer side).
- App uses `streamText` + `pipeUIMessageStreamToResponse` (the server side).
- Conversations need to survive reloads, app restarts, account migrations.
- App already has `electron-pglite-drizzle` from the `electron-desktop` plugin (or an equivalent PGLite + Drizzle layer) and this plugin's `vercel-ai-multi-provider` skill.

## Why JSONB-as-parts and not a separate `tool_calls` table?

The AI SDK's `UIMessage.parts` is a discriminated union: `{ type: "text", text }`, `{ type: "tool-invocation", toolCallId, toolName, state, input, output }`, `{ type: "reasoning", text }`, etc. Order matters — interleaved text + tool calls + text are common. A normalized schema (one table per part type) would need an `order_index` per part anyway *and* a join across N tables on every load.

Storing the array as a JSONB column:
- Round-trips cleanly: load returns the same shape useChat sent.
- Order is preserved by JSONB array semantics.
- New part types from the SDK don't need migrations.
- The DB never has a "half-stored" message — the row writes atomically.

The cost: you can't query inside parts efficiently. For this use case (chat history that's loaded by conversation id and rendered as-is) that's fine. If you ever need "show all messages that called tool X", denormalize at write time — don't change the storage shape.

## What it scaffolds (mixed: schema + route handler + heavy guidance)

| Source | Destination |
|---|---|
| `templates/src/main/db/schema-additions.ts` | Append to your `src/main/db/schema.ts` |
| `templates/src/main/db/migration-001-chat-tables.sql.ts` | Append entry to your `MIGRATIONS` array |
| `templates/src/main/routes/chat.ts` | `src/main/routes/chat.ts` (full route handler) |

The chat route is a complete file but assumes the surrounding skills:
- `getDb()` from `electron-pglite-drizzle` in the `electron-desktop` plugin
- `resolveModel`, `getProviderOptions`, `modelLabel`, `isEffortLevel`, `DEFAULT_EFFORT` from `vercel-ai-multi-provider`
- `getApiKey` from `electron-encrypted-settings` in the `electron-desktop` plugin
- `showNotification` from `electron-native-notifications` in the `electron-desktop` plugin (optional — drop the call if not using it)
- `loadInstructions`, `createTools` — your app's domain (system prompt + tool set)

## Decision points

- **Id ownership** — UIMessage ids are TEXT primary keys, **client-generated for user messages**, server-generated (`generateId()`) for assistant. The route accepts the client's user-message ids verbatim and only mints new ids for the assistant side. Don't UUID-coerce — the client expects to see its own ids back.
- **`order_index` allocation** — explicit integer column. On each persist pass: `SELECT MAX(order_index) WHERE conversation_id = ?`, increment per inserted message. Don't rely on `created_at` ordering — message inserts can be milliseconds apart and timestamp ties are surprisingly common.
- **Title generation** — defaults to a one-shot LLM call on the first user message (see `generateConversationTitle` in the template). Falls back to truncated user text if no key. Drop the LLM path if your app shouldn't make an extra API call per new conversation.
- **AI SDK version pin** — the `streamText` / `convertToModelMessages` API has churned. Pin `ai` to a known-good range in `package.json` and document the version this template was written against (currently `ai@^6.0.x`).

## The `onFinish` persistence path

This is the bit that most "AI chat tutorial" code skips:

```typescript
result.pipeUIMessageStreamToResponse(res, {
  originalMessages: history,
  generateMessageId: generateId,
  onFinish: async ({ messages: allMessages, responseMessage, isAborted }) => {
    for (const msg of allMessages) {
      const existing = await db.select(...).from(messages).where(eq(messages.id, msg.id));
      if (existing.length === 0) {
        // INSERT new message
      } else if (msg.id === responseMessage.id) {
        // UPDATE the assistant turn (covers isContinuation extending)
      } else if (msg.role === "assistant") {
        // UPDATE prior assistant turn whose parts changed (e.g. client-side
        // tool fulfilment via addToolOutput between turns)
      }
      // User messages are intentionally NOT updated — see below
    }
  },
});
```

Three cases worth understanding:

1. **New message** — insert with the next `order_index`. This is the common case.
2. **Response continuation** — when the assistant's previous turn ended mid-stream (`isContinuation`), the SDK keeps the same id and extends `parts`. Update `parts` + `metadata` to the latest state.
3. **Prior assistant message changed** — the renderer can fulfil client-side tool calls *between* turns via `addToolOutput`. The next request sends the updated parts; persist them so they survive a reload.

User messages are NOT updated on subsequent persists. The reason: the server-side route prepends `<attached_document>` text parts to the latest user message before sending to the model. The client doesn't know about those parts; if we updated user-message rows from the client's view, we'd strip them.

## Token usage in `metadata`

The `messageMetadata` callback runs on `finish-step` and `finish` parts. Use it to attach token usage to assistant messages so the UI can render a usage widget. The Anthropic-specific quirk:

- The standard `inputTokenDetails.cacheWriteTokens` is undefined for Anthropic.
- Anthropic exposes `cacheCreationInputTokens` per finish-step in `providerMetadata.anthropic`.
- Accumulate it across steps, fall back to it on the final `finish` event.

The template's `messageMetadata` has the right code; preserve it.

## Abort handling

Tie the streamText call to the HTTP request lifetime:

```typescript
const abortController = new AbortController();
req.on("close", () => {
  if (!res.writableEnded) abortController.abort();
});

const result = streamText({
  // ...
  abortSignal: abortController.signal,
});
```

Without this, when the user clicks "Stop" (which calls `useChat`'s `stop()`, which closes the fetch), the provider keeps generating tokens you'd just discard. That's billed cost the user already cancelled.

## Provider-native web search

Optional: if you want the agent to look up current info, add a provider-native web search tool. The template shows the pattern for Anthropic and OpenAI; Gemini's google-search grounding is configured differently (provider option, not a tool). Drop this block entirely if your agent doesn't need web search.

## Anthropic prompt caching (worth keeping)

Two cache breakpoints, marked with `cacheControl: { type: "ephemeral", ttl: "1h" }`:
1. The system prompt (passed as a message rather than top-level `system` string so it can carry providerOptions).
2. The last tool definition.

Anthropic caches up to four breakpoints; marking the system + tools makes the entire stable prefix a cache hit on every subsequent turn within the 1h TTL. The cache markers are silently ignored by OpenAI and Gemini, so leaving them on for cross-provider code costs nothing.

## Source

Lifted from:
- [trident/src/main/db/schema.ts](https://github.com/eastechs/trident/blob/main/src/main/db/schema.ts) (`messages`, `conversations` tables)
- [trident/src/main/routes/chat.ts](https://github.com/eastechs/trident/blob/main/src/main/routes/chat.ts)
- [trident/src/main/routes/conversations.ts](https://github.com/eastechs/trident/blob/main/src/main/routes/conversations.ts)
