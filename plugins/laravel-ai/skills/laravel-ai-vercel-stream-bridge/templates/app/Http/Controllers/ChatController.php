<?php

namespace App\Http\Controllers;

use App\Ai\Agents\ExampleAgent;
use App\Http\Controllers\Concerns\HandlesAgentChat;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Ai\Responses\StreamableAgentResponse;

class ChatController extends Controller
{
    use HandlesAgentChat;

    /**
     * Stream an agent response over the Vercel data protocol.
     *
     * The renderer (using `useChat` from `@ai-sdk/react`) gets the standard
     * wire format: text deltas, tool calls, reasoning, usage, finish events.
     * The `then(...)` callback runs after the stream closes — the right
     * place for "rename conversation on first message", notifications, etc.
     */
    public function send(Request $request, Project $project): StreamableAgentResponse
    {
        $validated = $request->validate([
            'message' => ['required', 'string'],
            'model_id' => ['required', 'string'],
            'conversation_id' => ['required', 'string'],
            'side' => ['sometimes', 'string', 'in:left,right'],
            'document_ids' => ['array'],
            'document_ids.*' => ['string'],
        ]);

        $modelId = $validated['model_id'];
        $provider = $this->resolveProvider($modelId);
        $conversationId = $validated['conversation_id'];

        $documentIds = $validated['document_ids'] ?? [];
        $attachments = $this->buildAttachments($project, $documentIds);

        // Single-user desktop app convention; replace with your auth user
        // (`$request->user()`) for a multi-user web app.
        $user = (object) ['id' => 'anonymous'];

        $agent = (new ExampleAgent($project, $modelId))
            ->continue($conversationId, as: $user);

        // The two non-obvious lines. Read the SKILL.md if you don't already
        // know why these are here.
        session()->save();
        set_time_limit(0);

        $side = $validated['side'] ?? null;
        $message = $validated['message'];

        return $agent
            ->stream($message, provider: $provider, model: $modelId, attachments: $attachments)
            ->usingVercelDataProtocol()
            ->then(function ($response) use ($conversationId, $modelId, $side, $message): void {
                $this->updateMessageMeta($conversationId, $modelId);
                $this->updateConversationOnFirstMessage($conversationId, $modelId, $side, $message);

                // Optional: fire an OS notification with a preview of the
                // response. Drop this branch if you're not in NativePHP.
                // \Native\Desktop\Facades\Notification::title($modelId)
                //     ->message(Str::of($response->text)->explode("\n")->take(3)->join("\n"))
                //     ->show();
            });
    }

    /**
     * Clear all messages in all conversations for this project.
     */
    public function clear(Project $project): JsonResponse
    {
        $conversationIds = DB::table('agent_conversations')
            ->where('project_id', $project->id)
            ->pluck('id');

        if ($conversationIds->isNotEmpty()) {
            DB::table('agent_conversation_messages')
                ->whereIn('conversation_id', $conversationIds)
                ->delete();
        }

        $project->touch();

        return response()->json(null, 204);
    }

    /**
     * Return the messages of a single conversation in the shape the
     * renderer expects (JSON-decoded tool_calls / tool_results / meta).
     */
    public function messages(Request $request, Project $project): JsonResponse
    {
        $conversationId = $request->query('conversation_id');

        if (! $conversationId) {
            return response()->json([]);
        }

        $messages = DB::table('agent_conversation_messages')
            ->where('conversation_id', $conversationId)
            ->orderBy('created_at')
            ->get()
            ->map(fn ($message) => [
                'id' => $message->id,
                'role' => $message->role,
                'content' => $message->content,
                'tool_calls' => json_decode($message->tool_calls, true),
                'tool_results' => json_decode($message->tool_results, true),
                'meta' => json_decode($message->meta, true),
                'usage' => json_decode($message->usage, true),
                'created_at' => $message->created_at,
            ]);

        return response()->json($messages);
    }
}
