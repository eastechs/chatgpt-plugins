<?php

namespace App\Http\Controllers\Concerns;

use App\Models\Document;
use App\Models\Project;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Ai\Files;

use function Laravel\Ai\agent;

/**
 * Shared bits the streaming chat controller (and any other controller that
 * needs to send a one-shot agent prompt) reuse.
 *
 * Adjust `resolveProvider()` if you support providers beyond
 * Anthropic / OpenAI / Gemini.
 */
trait HandlesAgentChat
{
    /**
     * Map a model id to the provider name `Laravel\Ai` expects.
     *
     * Intentionally textual — new model releases under an existing provider
     * don't break this. Adding a new provider is one new prefix branch.
     */
    protected function resolveProvider(string $modelId): string
    {
        if (str_starts_with($modelId, 'claude-')) {
            return 'anthropic';
        }

        if (str_starts_with($modelId, 'gemini-')) {
            return 'gemini';
        }

        return 'openai';
    }

    /**
     * Build `Laravel\Ai\Files\Document` attachments from a list of
     * Document model ids.
     *
     * Pass real on-disk paths (`->path(...)`), not loaded contents — the
     * Files abstraction needs a path it can stream. `->as($name)` controls
     * the filename the model sees.
     *
     * @return list<Files\Document>
     */
    protected function buildAttachments(Project $project, array $documentIds): array
    {
        if (empty($documentIds)) {
            return [];
        }

        return Document::query()
            ->whereIn('id', $documentIds)
            ->where('project_id', $project->id)
            ->get()
            ->map(fn (Document $doc) => Files\Document::fromPath(
                Storage::disk('user_home')->path($doc->path)
            )->as($doc->name))
            ->all();
    }

    /**
     * On the first user message in a conversation: backfill the model id,
     * generate a title, and store which side of the UI the conversation
     * lives on (left/right panel in a split-view chat).
     *
     * Called from the streaming controller's `then()` callback so it runs
     * once the agent's response has been fully written.
     */
    protected function updateConversationOnFirstMessage(
        string $conversationId,
        string $modelId,
        ?string $side,
        string $message,
    ): void {
        $conversation = DB::table('agent_conversations')
            ->where('id', $conversationId)
            ->first();

        if (! $conversation) {
            return;
        }

        $updates = ['updated_at' => now()];

        if ($conversation->model === null) {
            $updates['model'] = $modelId;
        }

        if ($conversation->title === 'New Chat') {
            $updates['title'] = $this->generateTitle($message);
        }

        if ($side !== null) {
            $updates['side'] = $side;
        }

        DB::table('agent_conversations')
            ->where('id', $conversationId)
            ->update($updates);
    }

    /**
     * Backfill `meta.target_model` and `meta.sender` on the messages this
     * turn produced. `target_model` is which model the user wanted to
     * answer; `sender` is which model actually answered (same id for
     * single-model setups, can differ in multi-agent flows).
     */
    protected function updateMessageMeta(string $conversationId, string $modelId): void
    {
        $userMeta = json_encode(['sender' => 'user', 'target_model' => $modelId]);

        DB::table('agent_conversation_messages')
            ->where('conversation_id', $conversationId)
            ->where('role', 'user')
            ->where('meta', '[]')
            ->update(['meta' => $userMeta]);

        $assistantMessages = DB::table('agent_conversation_messages')
            ->where('conversation_id', $conversationId)
            ->where('role', 'assistant')
            ->whereRaw("json_extract(meta, '$.target_model') IS NULL")
            ->get(['id', 'meta']);

        foreach ($assistantMessages as $message) {
            $existing = json_decode($message->meta, true) ?: [];
            $existing['sender'] = $modelId;
            $existing['target_model'] = $modelId;

            DB::table('agent_conversation_messages')
                ->where('id', $message->id)
                ->update(['meta' => json_encode($existing)]);
        }
    }

    /**
     * One-shot LLM call to mint a short conversation title from the first
     * user message. Falls back to a truncated copy of the message if the
     * call fails or the response is empty.
     *
     * Drop this method (and inline a `Str::limit` fallback in
     * `updateConversationOnFirstMessage`) if you'd rather not pay for a
     * second LLM call per new conversation.
     */
    protected function generateTitle(string $message): string
    {
        try {
            $response = agent(
                instructions: 'Generate a short, descriptive title for a conversation based on the user\'s first message. Max 50 characters. No quotes. Just the title.',
            )->prompt($message, provider: 'openai', model: 'gpt-5.4-nano');

            $title = trim((string) $response);

            return $title ?: Str::of($message)->limit(50, '...')->toString();
        } catch (\Throwable) {
            return Str::of($message)->limit(50, '...')->toString();
        }
    }
}
