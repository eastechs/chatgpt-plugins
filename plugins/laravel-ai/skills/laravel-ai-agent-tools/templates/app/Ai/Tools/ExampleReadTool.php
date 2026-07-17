<?php

namespace App\Ai\Tools;

use App\Models\Document;
use App\Models\Project;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

/**
 * Read-side tool template — queries DB or filesystem and returns matches
 * the model can act on.
 *
 * Always scope by `$this->project->id`. Models hallucinate IDs; a search
 * tool that didn't filter would happily return another project's records.
 *
 * Empty results return `status: success` with an empty array, NOT
 * `status: error`. "I searched and found nothing" is a successful search.
 */
class ExampleReadTool implements Tool
{
    public function __construct(
        public Project $project,
    ) {}

    public function description(): Stringable|string
    {
        return 'Search for documents in the project by name. Use this when the user references a document by name that is not attached to the conversation. Returns matching document IDs and names.';
    }

    public function handle(Request $request): Stringable|string
    {
        $documents = Document::query()
            ->where('project_id', $this->project->id)
            ->where('name', 'like', '%'.$request['query'].'%')
            ->get(['id', 'name']);

        if ($documents->isEmpty()) {
            return json_encode([
                'status' => 'success',
                'documents' => [],
                'message' => 'No documents found matching that query.',
            ]);
        }

        return json_encode([
            'status' => 'success',
            'documents' => $documents->map(fn (Document $doc) => [
                'document_id' => $doc->id,
                'document_name' => $doc->name,
            ])->values()->all(),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'query' => $schema->string()
                ->required()
                ->description('The search term to match against document names.'),
        ];
    }
}
