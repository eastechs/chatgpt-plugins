---
name: laravel-ai-vercel-stream-bridge
description: Use when a Laravel app needs to stream a laravel/ai agent to a Vercel AI SDK React frontend using useChat. Scaffolds the controller, Vercel data-protocol stream chain, provider routing, attachment handling, conversation title creation, agent contracts, and session-lock release required for reliable streaming.
---

# laravel-ai-vercel-stream-bridge

Stream a Laravel AI agent to a Vercel-AI-SDK-React frontend over the canonical Vercel data protocol. The Laravel side returns a `StreamableAgentResponse`; the React side uses `useChat` from `@ai-sdk/react`; in between, `usingVercelDataProtocol()` does the framing work and `then()` runs after the stream closes (perfect spot for "rename conversation on first message", "fire OS notification", "update tracing", etc).

## When to use

- Backend is Laravel 11+ with `laravel/ai`.
- Frontend uses `@ai-sdk/react` and wants the standard `useChat` hook.
- The agent has tools, conversation memory, attachments, or per-provider options — anything where you'd otherwise hand-roll an SSE response.

If the frontend is plain JS that just wants text chunks, this is overkill — call `$agent->stream(...)` and pipe text deltas yourself.

## What it scaffolds (mixed: code + heavy guidance)

| Source | Destination |
|---|---|
| `templates/app/Http/Controllers/ChatController.php` | `app/Http/Controllers/ChatController.php` |
| `templates/app/Http/Controllers/Concerns/HandlesAgentChat.php` | `app/Http/Controllers/Concerns/HandlesAgentChat.php` |
| `templates/app/Ai/Agents/ExampleAgent.php` | `app/Ai/Agents/{YourAgent}.php` (rename + customize tools) |
| `templates/resources/js/hooks/use-laravel-chat.ts` | `resources/js/hooks/use-laravel-chat.ts` |
| `templates/routes-fragment.php` | Append the routes into your `routes/web.php` |

The controller assumes the surrounding pieces:
- A `Project` model + route binding (or substitute your own scope)
- A `Document` model on a Laravel Storage disk for attachments (or remove the attachment plumbing)
- The `agent_conversations` + `agent_conversation_messages` tables installed via Laravel AI's `AiMigration` base class

## Decision points

- **Agent class name** — Joust calls it `DocumentCollaborator`. Pick whatever fits your domain.
- **Conversation memory** — the template uses `RemembersConversations`. Drop it (and the `continue(...)` call) for stateless one-shot agents.
- **Title generation strategy** — defaults to a one-shot `agent()` call against `gpt-5.4-nano` to mint a short title from the first user message, falling back to truncated text if the call fails. Drop the LLM path if you'd rather not pay for a small extra call per new conversation.
- **Provider routing** — defaults to "starts-with `claude-` → anthropic, `gemini-` → gemini, else openai". Adjust `resolveProvider()` if you support more providers.
- **Notification on completion** — the `then()` callback fires a NativePHP `Notification` with a 3-line preview. Strip it if you're not in NativePHP, or replace with a broadcast/event/whatever.

## The non-obvious bits

### `set_time_limit(0)` + `session()->save()` BEFORE the stream

```php
session()->save();
set_time_limit(0);

return $agent->stream(...)->usingVercelDataProtocol()->then(...);
```

Both lines matter:

- **`session()->save()`** — Laravel's default session driver acquires a lock on the session file/row at the start of the request and releases it at the end. A streaming response stays "in flight" for the full duration of the agent's run; if any *other* request from the same session hits the server in that window, it blocks waiting for the lock. Calling `save()` early flushes session state and releases the lock, so the renderer can keep loading data while the stream runs.
- **`set_time_limit(0)`** — PHP's `max_execution_time` (and Apache/nginx/php-fpm's own request timers) will kill long streams in the middle of token generation. `0` means "no limit". Pair this with `phpIni()` overrides in NativePHP or matching server config in production.

Skipping either of these works *just well enough* in a happy-path local dev session that the bug doesn't show up until the user opens a second tab or the agent runs longer than the default 30s timeout. Bake them in.

### `then()` runs after the stream closes, NOT before the response

The closure passed to `then()` runs after the entire stream has flushed. The `$response` argument has the assembled text, usage, tool calls — everything. This is the right spot for:

- Updating conversation title from the first user message.
- Backfilling per-message metadata (model, target_model, sender) once you know what model actually answered.
- Firing notifications/webhooks.
- Updating last-active timestamps.

Don't put logic that needs to *modify the response* here — it's already gone. For modifying the stream itself (e.g. injecting custom data parts), use Laravel AI's middleware/event hooks instead.

### `Files\Document::fromPath(...)->as($displayName)` for attachments

Laravel AI accepts attachments via the `attachments:` named arg on `stream(...)` / `prompt(...)`. The shape is `Laravel\Ai\Files\Document` (or `Image`, `Audio`, etc).

```php
Files\Document::fromPath(Storage::disk('user_home')->path($doc->path))->as($doc->name)
```

Two things to note:
- Pass the *real filesystem path*, not a `Storage::disk(...)->get($path)` result. The Files abstraction needs a path it can stream.
- `->as($displayName)` controls what the model sees as the filename. Without it, the model sees the on-disk name (which may be a UUID).

### Provider routing by model-id prefix

The "starts-with `claude-`" check is intentionally textual, not a model-registry lookup. New Anthropic releases don't break it; new providers just need a new prefix branch. Don't refactor this into a config-driven map — it gets harder to grep, not easier.

### `#[MaxSteps(N)]` on the agent class

Laravel AI's default step cap (≈ 5) is usually too low for real tool-using agents. Joust uses `MaxSteps(25)`. Pick a number that fits your tools' typical chains; if the model hits the cap mid-task, you'll see a truncated turn instead of a tool call resolving normally. The agent template ships with `25` as a starting point.

### `providerOptions()` switches on `Lab|string`

`HasProviderOptions::providerOptions()` is called once per provider per call. The argument is `Laravel\Ai\Enums\Lab|string` — match BOTH forms:

```php
if ($provider === 'anthropic' || $provider === Lab::Anthropic) { ... }
```

This shape is in flux upstream — current versions of Laravel AI sometimes pass strings, sometimes the enum. Matching both is the safe form. Don't `instanceof Lab` because strings won't match.

### `continue($conversationId, as: $user)` BEFORE `stream(...)`

Order matters:

```php
$agent = (new YourAgent($project, $modelId))
    ->continue($conversationId, as: $user);

return $agent->stream($message, ...);
```

The `continue(...)` call attaches the agent to a persisted conversation (via `RemembersConversations`). Calling `stream(...)` first and then trying to `continue(...)` won't load prior history — the prompt has already been built.

### Frontend: `useChat({ api: '/projects/{id}/chat' })`

The React side is mostly stock `useChat`. The one Joust-specific bit is sending `conversation_id`, `model_id`, `side`, and `document_ids` as `body` overrides on each call. The hook template shows the shape.

## Cross-controller reuse: the `HandlesAgentChat` trait

Two things end up needing this trait:

1. The streaming chat controller (this skill).
2. Any other place that needs to send a one-shot agent prompt — e.g. a "regenerate title" endpoint, an "extract entities from this document" job.

The trait keeps the provider-routing logic and the attachment-building logic in one place. If you need a third caller, add the helper there — don't duplicate.

## What the renderer sees

`usingVercelDataProtocol()` emits the same byte-level wire format that the AI SDK's TypeScript server adapters produce. The hook gets:

- Text deltas as `0:"..."` lines
- Tool calls as `1:{...}` / `2:{...}` lines
- Reasoning as `g:"..."` lines (where supported)
- Usage + finish events at the end

You don't need to parse this — `useChat` does. But knowing it's there makes the protocol debuggable: open Network → Fetch/XHR → click the chat request → Response tab. If you see those line prefixes, the bridge is working.

## Pairs well with

- **`laravel-ai-agent-tools`** — the agent template imports tools; that skill is how you author them. Use them together.
- A future Langfuse-tracing skill (Joust's `LangfuseTracing` listener subscribes to `PromptingAgent`/`StreamingAgent`/`InvokingTool`/etc and produces traces + per-tool spans).

## Source

Lifted from:
- `joust/app/Http/Controllers/ChatController.php`
- `joust/app/Http/Controllers/Concerns/HandlesAgentChat.php`
- `joust/app/Ai/Agents/DocumentCollaborator.php`
- `joust/routes/web.php` (chat routes)
