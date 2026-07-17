<?php

namespace App\Ai\Agents;

use App\Models\Project;
use Laravel\Ai\Attributes\MaxSteps;
use Laravel\Ai\Concerns\RemembersConversations;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\Conversational;
use Laravel\Ai\Contracts\HasProviderOptions;
use Laravel\Ai\Contracts\HasTools;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Enums\Lab;
use Laravel\Ai\Promptable;
use Stringable;

/**
 * Skeleton agent. Rename to fit your domain (e.g. DocumentCollaborator,
 * ResearchAssistant, CodeReviewer). The four contracts below cover the
 * common cases:
 *
 *   Agent              — required marker.
 *   Conversational     — paired with `RemembersConversations` for memory.
 *   HasProviderOptions — per-provider knobs (thinking, reasoning effort).
 *   HasTools           — agent calls tools (the laravel-ai-agent-tools skill covers tool authoring).
 *
 * Drop `Conversational` + `RemembersConversations` for stateless one-shots.
 * Drop `HasTools` if your agent only generates text.
 */
#[MaxSteps(25)]
class ExampleAgent implements Agent, Conversational, HasProviderOptions, HasTools
{
    use Promptable, RemembersConversations;

    public function __construct(
        public Project $project,
        public string $modelId = '',
    ) {}

    /**
     * Provider-specific options. Called once per provider per call.
     *
     * The argument is `Lab|string` — match BOTH forms. Current versions of
     * Laravel AI sometimes pass strings, sometimes the enum, and the shape
     * is in flux upstream. `instanceof Lab` will silently miss the string
     * case.
     *
     * @return array<string, mixed>
     */
    public function providerOptions(Lab|string $provider): array
    {
        if ($provider === 'anthropic' || $provider === Lab::Anthropic) {
            return [
                'thinking' => [
                    'enabled' => true,
                    'budgetTokens' => 10_000,
                ],
            ];
        }

        if ($provider === 'openai' || $provider === Lab::OpenAI) {
            return [
                'reasoning' => [
                    'effort' => 'high',
                    'summary' => 'auto',
                ],
            ];
        }

        // Gemini: no extra options on by default.
        return [];
    }

    /**
     * The agent's system prompt. Returning a `Stringable` (e.g. a value
     * loaded from disk) instead of a hardcoded string lets users override
     * it without redeploying.
     */
    public function instructions(): Stringable|string
    {
        return <<<'INSTRUCTIONS'
        You are a helpful assistant working with the user on the contents of this project.
        Use the provided tools to read, search, and modify documents in the project.
        Keep responses concise; prefer documents over chat for any long-form output.
        INSTRUCTIONS;
    }

    /**
     * The tools available to the agent. See the laravel-ai-agent-tools skill for tool authoring;
     * each entry is an instance of a class implementing `Laravel\Ai\Contracts\Tool`.
     *
     * @return Tool[]
     */
    public function tools(): iterable
    {
        return [
            // new \App\Ai\Tools\YourReadTool($this->project),
            // new \App\Ai\Tools\YourWriteTool($this->project, $this->modelId),
            // new \App\Ai\Tools\AskQuestions,
        ];
    }

    /**
     * Cap the number of historical messages sent on each turn. Once the
     * conversation grows past this, the oldest messages are dropped. Tune
     * to fit your typical model's context window and latency budget.
     */
    protected function maxConversationMessages(): int
    {
        return 100;
    }
}
