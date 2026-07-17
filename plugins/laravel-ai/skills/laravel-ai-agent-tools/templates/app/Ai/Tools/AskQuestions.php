<?php

namespace App\Ai\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

/**
 * Interactive tool template — renders a multiple-choice questionnaire in
 * the chat UI and pauses the agent until the user responds.
 *
 * Two things make this work:
 *
 * 1. The description explicitly tells the model to STOP after calling.
 *    Without that, the model invents the user's answers and barrels on.
 *    The instruction has to live in the description (right next to the
 *    tool definition) — system-prompt instructions are weaker.
 *
 * 2. The handler returns `status: pending` (not `success`). The renderer
 *    keys off this to render the form; the model also sees the pending
 *    payload as belt-and-braces reinforcement of the description.
 *
 * The user's answers arrive as their next user message in the
 * conversation; the agent picks them up on the next turn naturally
 * through `RemembersConversations`.
 */
class AskQuestions implements Tool
{
    public function description(): Stringable|string
    {
        return <<<'DESC'
        Present clarifying questions to the user before proceeding with work. This tool displays an interactive questionnaire in the chat UI. Each question has multiple-choice options the user can select from, plus a freeform "Something else" option.

        IMPORTANT: After calling this tool, you MUST stop and wait for the user's answers. Do NOT continue with any other actions or tool calls until you receive the user's response. The user's answers will arrive as their next message.

        Use this tool to:
        - Clarify the user's intent before doing any work
        - Gather requirements and preferences
        - Understand constraints and priorities
        - Ask follow-up questions after receiving initial answers

        Group related questions together (3-5 per call). Provide clear, specific options with helpful descriptions.
        DESC;
    }

    public function handle(Request $request): Stringable|string
    {
        return json_encode([
            'status' => 'pending',
            'message' => 'Questions have been presented to the user. STOP here and wait for their answers before continuing.',
            'questions' => $request['questions'],
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'questions' => $schema->array()
                ->required()
                ->min(1)
                ->items(
                    $schema->object([
                        'question' => $schema->string()
                            ->required()
                            ->description('The question text to display to the user.'),
                        'options' => $schema->array()
                            ->required()
                            ->min(2)
                            ->items(
                                $schema->object([
                                    'label' => $schema->string()
                                        ->required()
                                        ->description('Short answer text (1-5 words).'),
                                    'description' => $schema->string()
                                        ->required()
                                        ->description('Longer explanation of this option (1-2 sentences).'),
                                ])
                            )
                            ->description('The available choices for this question.'),
                    ])
                )
                ->description('The list of questions to present to the user.'),
        ];
    }
}
