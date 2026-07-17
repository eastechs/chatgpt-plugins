---
name: laravel-ai-agent-tools
description: >-
  Use when authoring tools for a Laravel AI agent with the laravel/ai package.
  Provides templates for write-side, read-side, and interactive tools, including
  the Tool contract, JsonSchema builder, structured status returns, project
  scoping, and the stop-and-wait contract for interactive tools.
---

# laravel-ai-agent-tools

Tools are how a Laravel AI agent does anything other than generate text. This skill captures the three idioms a real codebase hits over and over, with templates for each.

## When to use

- Adding a tool to an agent built with `laravel/ai`.
- Migrating ad-hoc "function calling" code into the proper `Tool` contract shape.
- Standardizing return shapes across an existing tool set so the renderer can parse them uniformly.

## What it scaffolds

| Source | Destination | Idiom |
|---|---|---|
| `templates/app/Ai/Tools/ExampleWriteTool.php` | `app/Ai/Tools/{YourWriteTool}.php` | Write-side: mutates state, returns IDs |
| `templates/app/Ai/Tools/ExampleReadTool.php` | `app/Ai/Tools/{YourReadTool}.php` | Read-side: queries DB, returns matches |
| `templates/app/Ai/Tools/AskQuestions.php` | `app/Ai/Tools/AskQuestions.php` | Interactive: renders UI, pauses agent |

Drop them in, rename, edit. None of them are runnable as-is — they're scaffolds.

## The contract

Every tool implements `Laravel\Ai\Contracts\Tool` with three methods:

```php
public function description(): Stringable|string;
public function handle(Request $request): Stringable|string;
public function schema(JsonSchema $schema): array;
```

- **`description()`** is what the model sees. Spend real effort here — most "the model isn't calling my tool" bugs are description bugs. Tell the model *when* to use the tool (and when not to), not just what it does.
- **`handle($request)`** runs server-side. `$request` is `Laravel\Ai\Tools\Request`; access args with array syntax (`$request['document_id']`). The return must be a string or `Stringable` — convention is JSON-encoded with a `status` key (see below).
- **`schema($schema)`** returns an array of `JsonSchema` builders keyed by argument name. The schema is what gets sent to the model as the tool's parameter spec. Match the keys here to what `handle()` reads from `$request`.

## The `status` return-shape convention

Joust standardizes on three values:

```php
return json_encode(['status' => 'success', /* …data… */]);
return json_encode(['status' => 'error',   'message' => '…why…']);
return json_encode(['status' => 'pending', /* …UI payload… */]);  // interactive only
```

The renderer can then key off `status` to decide how to display the tool result — green/red/pending pill, error toast, interactive form, etc — without parsing differently per tool.

This isn't enforced by the framework. It's a convention. Stick to it.

## Idiom 1 — Write-side tools

Mutate project state (DB rows + on-disk files), return enough info for the renderer to update its view.

**Shape:**

```php
class CreateDocument implements Tool
{
    public function __construct(
        public Project $project,
        public string $modelId = '',
    ) {}
    // …
}
```

**Why constructor inject `Project` and `modelId`:**

- The agent class instantiates tools per-conversation (`new CreateDocument($this->project, $this->modelId)` inside `tools()`), so the tool knows *which* project to write into and *which* model is asking. Letting the model pass `project_id` as a tool arg is a footgun — models hallucinate UUIDs, and an agent shouldn't be able to write to a different project than the one its conversation belongs to.
- `modelId` lets the tool tag rows with `created_by` / `last_edited_by` so the UI can attribute work correctly in multi-model setups.

**Why duplicate the write to disk AND the database:**

Joust's pattern is "DB row is the source of truth, on-disk file is a synced projection". The disk copy gives users a real `.md` file they can open in any editor, sync via Dropbox, grep with ripgrep, etc. The DB row gives the app fast queries and relations.

If your app doesn't need the on-disk projection, drop the `Storage::disk(...)` calls.

## Idiom 2 — Read-side tools

Query the DB or filesystem, return results the model can pick from.

**Shape:**

```php
return json_encode([
    'status' => 'success',
    'documents' => $documents->map(fn ($doc) => [
        'document_id' => $doc->id,
        'document_name' => $doc->name,
    ])->values()->all(),
]);
```

**Why scope by `$this->project->id` in the query:**

Same reason as write-side — models hallucinate IDs. A `SearchDocuments` that didn't filter by project would happily return another project's docs if the model asked the wrong question. Scope at the boundary, not in the prompt.

**Empty result is `success`, not `error`:**

```php
if ($documents->isEmpty()) {
    return json_encode([
        'status' => 'success',
        'documents' => [],
        'message' => 'No documents found matching that query.',
    ]);
}
```

`error` is for "the tool couldn't do its job" (DB down, file unreadable). "I searched and found nothing" is a successful search. The model needs to be able to tell the difference to decide what to do next.

## Idiom 3 — Interactive tools (`AskQuestions` / `ConfigureImageGeneration` / etc)

The tool *renders something in the chat UI* and the agent's job is to STOP. The user's response arrives as their next user message, which the agent picks up on the next turn.

**Critical: the description has to teach the model to stop:**

```
IMPORTANT: After calling this tool, you MUST stop and wait for the user's
answers. Do NOT continue with any other actions or tool calls until you
receive the user's response. The user's answers will arrive as their next
message.
```

Without this, the model calls `AskQuestions`, then immediately hallucinates the user's answer and barrels onward. The instruction has to be in the tool's description, not just in the system prompt — the model is more likely to honor it when it's right next to the tool definition.

**The handler returns `pending`, not `success`:**

```php
return json_encode([
    'status' => 'pending',
    'message' => 'Questions have been presented to the user. STOP here and wait for their answers before continuing.',
    'questions' => $request['questions'],
]);
```

Two purposes:
1. The `pending` status tells the renderer "render the interactive form". The renderer reads `questions` (or `type: 'image_config'` for ConfigureImageGeneration, etc) and switches on the shape.
2. The `STOP here` text is a belt-and-braces reinforcement of the description — the model also sees the tool *result* before deciding what to do next.

**Schema for `AskQuestions`** is a nested array — see the template. The UI renders one `<fieldset>` per question with a radio per option.

## Decision points (per tool)

- **Project scope** — almost always yes. Pass `Project` as a constructor arg; never accept it as a model-supplied parameter.
- **Modifies disk?** — if yes, use `Storage::disk('user_home')` (or whatever your `nativephp-userhome-disk` equivalent is) and write *after* the DB transaction succeeds, not before. A failed disk write should leave the DB row in place; a failed DB write should not have already written a file.
- **Filesystem traversal arg?** — see Joust's `ListDirectory` / `SearchFiles` for the realpath-based escape guard. Reject any resolved path that doesn't start with the workspace root.
- **`status` payload shape** — keep keys consistent across tools that return the same kind of thing. If `CreateDocument` returns `document_id` and `document_name`, `EditDocument` should too. The renderer (and the model) benefit from the regularity.

## The `tools()` method on the agent

Tools get instantiated *per-conversation*, in the agent's `tools()` method:

```php
public function tools(): iterable
{
    return [
        new AskQuestions,
        new SearchDocuments($this->project),
        new ReadDocument($this->project),
        new EditDocument($this->project, $this->modelId),
        new CreateDocument($this->project, $this->modelId),
    ];
}
```

The order doesn't matter for behavior, but ordering by "read first, write second, interactive last" makes the list scannable.

## Pairs well with

- **`laravel-ai-vercel-stream-bridge`** — the agent template there imports tools via `tools()`. These two skills are routinely used together.
- A future "workspace-bounded filesystem tools" skill would lift Joust's `ListDirectory` / `SearchFiles` / `ReadFile` with the realpath traversal guard. Worth its own skill since the guard logic is the reusable part, not the tool wrapper.

## Source

Lifted from:
- `joust/app/Ai/Tools/CreateDocument.php` (write-side)
- `joust/app/Ai/Tools/EditDocument.php` (write-side)
- `joust/app/Ai/Tools/SearchDocuments.php` (read-side)
- `joust/app/Ai/Tools/AskQuestions.php` (interactive)
- `joust/app/Ai/Tools/ConfigureImageGeneration.php` (interactive, no args)
