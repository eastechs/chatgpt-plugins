---
name: pglite-pgvector-embeddings
description: Use when an Electron app already has PGLite + Drizzle through the electron-desktop plugin's electron-pglite-drizzle skill (or an equivalent database layer) and needs RAG-style embeddings plus cosine-similarity search over markdown documents. Adds the pgvector extension, HNSW indexing, heading-aware chunking, retry logic, transactional re-embedding, and project-scoped search.
---

# pglite-pgvector-embeddings

RAG embeddings on top of PGLite. Builds on `electron-pglite-drizzle` from the `electron-desktop` plugin (or an equivalent database + migration layer) and adds the `vector` extension, an embeddings table with an HNSW index, and the chunking + embedding + search pipeline.

## When to use

- App stores markdown (or other text) and needs semantic search across it.
- App already uses `electron-pglite-drizzle` from the `electron-desktop` plugin; the migration runner is in place.
- OpenAI key handling already exists through that plugin's `electron-encrypted-settings` skill (`getApiKey`) or an equivalent module.
- 1536-dim embeddings (`text-embedding-3-small`) are fine — no need for higher-dim or specialised models.

If you don't have `electron-pglite-drizzle` in place yet, install the `electron-desktop` plugin and build that layer first. This skill assumes its existence.

## What it scaffolds (mixed: templates + heavy guidance)

| Source | Destination |
|---|---|
| `templates/src/main/db/migration-002-embeddings.sql.ts` | Append to `MIGRATIONS` array in `src/main/db/migrations.ts` (it's a snippet, not a full file) |
| `templates/src/main/db/schema-additions.ts` | Append to `src/main/db/schema.ts` |
| `templates/src/main/ai/embeddings.ts` | `src/main/ai/embeddings.ts` |

The migration and schema templates are *fragments* — merge them into your existing files. The embeddings.ts is a complete drop-in.

## Decision points

- **Embedding model** — defaults to `text-embedding-3-small` (1536 dims, OpenAI). Alternatives: `text-embedding-3-large` (3072 dims, more expensive, marginally better recall), Voyage (`voyage-3-lite` — 512 dims, cheaper). If you change this, change the `VECTOR(1536)` in the migration to match.
- **Token cap per chunk** — defaults to 512. Trade-off: smaller chunks → more rows, finer-grained recall, but more embedding API calls. Larger chunks → cheaper to ingest, lossier search. 512 is a reasonable midpoint for general docs.
- **MIN_SIMILARITY floor** — defaults to 0.3. Below this is essentially noise for `text-embedding-3-small`. Without a floor, a small project always returns every doc since `topK > doc count`. Tune up if your corpus has consistently high similarity scores; tune down if it's sparse.
- **`MIN_SIMILARITY` location** — applied at the DB level via `cosineDistance < (1 - MIN_SIMILARITY)`. Don't filter in app code — that wastes the index lookup.
- **Per-project toggle** — defaults to `embeddings_enabled BOOLEAN NOT NULL DEFAULT TRUE` on `projects`. Lets users opt out per-project (privacy, cost). Drop if your app doesn't have projects.

## The chunker

Heading-aware: walks markdown line-by-line, splits at H1/H2/H3 boundaries, carries heading ancestry on each chunk. Sections that exceed `TOKEN_CAP` are further split on blank-line paragraph boundaries; a single oversized paragraph is emitted whole and accepts the overflow.

Why heading-aware: snippet display in search results becomes more useful when chunks correspond to logical sections. A chunk in a "## API Reference" section is more interpretable as a search result than a chunk randomly cut at the 512th token.

The token estimator is deliberately cheap: `Math.ceil(text.length / 4)`. Real tokenization via tiktoken would be heavier; chars/4 is a well-known approximation for English markdown that keeps you safely under the 8192-token model limit even at the high end. Don't bother with a real tokenizer here — the cost of a wrong-by-10% estimate is a slightly larger embedding API call, not a correctness issue.

## Re-embedding semantics

`embedDocument(documentId)` is the entry point for "this document changed, re-embed it". Three things matter:

1. **Per-document serialization.** A `Map<documentId, Promise<void>>` queues calls per id. Without this, two concurrent edits to the same doc race: delete-then-insert with stale content can land after a newer call's transaction, leaving older content in the chunks table.
2. **Delete-then-insert in a single transaction.** The doc never has a half-rebuilt embedding set visible to a search query.
3. **Silent skip on toggle off / no key.** No error UI for the common case of an unconfigured app — surface that elsewhere (onboarding, settings status).

The `withRetry` helper retries embed API calls with exponential-ish backoff: 250ms, 500ms, 1000ms. `NoOpenAIKeyError` is special-cased — it's not retried because the key won't appear by retrying.

## Search query shape

```sql
SELECT
  document_chunks.document_id,
  document_chunks.text,
  documents.name,
  documents.directory,
  1 - (document_chunks.embedding <=> $queryEmbedding) AS score
FROM document_chunks
JOIN documents ON documents.id = document_chunks.document_id
WHERE
  documents.project_id = $projectId
  AND document_chunks.embedding <=> $queryEmbedding < (1 - 0.3)
ORDER BY document_chunks.embedding <=> $queryEmbedding
LIMIT $topK * 5
```

Then dedupe by `document_id` in app code, keeping the highest-scoring chunk per doc. The `topK * 5` over-fetch lets the dedupe pass return up to `topK` distinct documents even when one document dominates the top of the chunk-level ranking.

The `cosineDistance` import is from `drizzle-orm` — gives you the `<=>` operator with type-safety. `1 - distance = similarity`.

## `NoOpenAIKeyError` typed-error pattern

Throw a named error class so the route handler can map it to a 409 (or whatever) without string-matching the message:

```typescript
try {
  const results = await searchProject(projectId, query);
  res.json(results);
} catch (err) {
  if (err instanceof NoOpenAIKeyError) {
    res.status(409).json({ error: "openai-key-missing" });
    return;
  }
  throw err;
}
```

Same pattern for embedding: agent tools that need search can `try/catch NoOpenAIKeyError` and silently degrade to file-name search instead of propagating an error to the model.

## Source

Lifted from:
- [trident/src/main/ai/embeddings.ts](https://github.com/eastechs/trident/blob/main/src/main/ai/embeddings.ts)
- [trident/src/main/db/migrations.ts](https://github.com/eastechs/trident/blob/main/src/main/db/migrations.ts) (migrations 002 + 003)
- [trident/src/main/db/schema.ts](https://github.com/eastechs/trident/blob/main/src/main/db/schema.ts)
