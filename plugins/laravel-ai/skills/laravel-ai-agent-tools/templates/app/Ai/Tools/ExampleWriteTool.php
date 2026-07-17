<?php

namespace App\Ai\Tools;

use App\Models\Document;
use App\Models\Project;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Storage;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

/**
 * Write-side tool template — mutates project state (DB row + on-disk file)
 * and returns the new state for the renderer to display.
 *
 * The duplicate write (DB + disk) is Joust's pattern: DB is source of
 * truth, disk is a synced projection users can open in any editor. Drop
 * the disk side if your app doesn't need it.
 *
 * Project and modelId are constructor args — NEVER accept them as
 * model-supplied parameters. Models hallucinate IDs, and an agent shouldn't
 * be able to write to a different project than its conversation belongs to.
 */
class ExampleWriteTool implements Tool
{
    public function __construct(
        public Project $project,
        public string $modelId = '',
    ) {}

    public function description(): Stringable|string
    {
        return 'Create a new document in the project. Use this when the user asks you to create a new document with specific content.';
    }

    public function handle(Request $request): Stringable|string
    {
        $name = $request['name'];
        $createdBy = $this->modelId ?: 'ai';
        $directory = $this->modelId ?: 'user';
        $dirPath = "{$this->project->path}/documents/{$directory}";
        $path = "{$dirPath}/{$name}.md";

        // Idempotency check: prefer telling the model to use Edit instead
        // of silently overwriting.
        $exists = Document::query()
            ->where('project_id', $this->project->id)
            ->whereRaw('LOWER(path) = LOWER(?)', [$path])
            ->exists();

        if ($exists) {
            return json_encode([
                'status' => 'error',
                'message' => "A document named '{$name}' already exists. Use EditDocument to update it, or choose a different name.",
            ]);
        }

        // DB first — if this throws, no orphan file is written.
        $document = $this->project->documents()->create([
            'name' => $name,
            'path' => $path,
            'directory' => $directory,
            'content' => $request['content'],
            'created_by' => $createdBy,
            'last_edited_by' => $createdBy,
        ]);

        // Then disk. A failure here is recoverable on next edit.
        $disk = Storage::disk('user_home');
        $disk->makeDirectory($dirPath);
        $now = now()->toIso8601String();
        $frontMatter = "---\nuuid: {$document->id}\nname: {$document->name}\ncreated_by: {$createdBy}\nlast_edited_by: {$createdBy}\nupdated_at: {$now}\n---\n";
        $disk->put($path, $frontMatter.$request['content']);

        return json_encode([
            'status' => 'success',
            'document_id' => $document->id,
            'document_name' => $document->name,
            'content' => $request['content'],
            'created_by' => $createdBy,
            'last_edited_by' => $createdBy,
            'directory' => $directory,
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'name' => $schema->string()
                ->required()
                ->description('The name for the new document (without file extension).'),
            'content' => $schema->string()
                ->required()
                ->description('The initial markdown content for the new document.'),
        ];
    }
}
