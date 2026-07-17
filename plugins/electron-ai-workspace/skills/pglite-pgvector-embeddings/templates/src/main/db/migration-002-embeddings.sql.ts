// MERGE: append this entry to the MIGRATIONS array in src/main/db/migrations.ts.
// Don't import this file at runtime — the array-of-migrations pattern in
// migrations.ts owns the apply path. This file is here for reference only.

export const MIGRATION_002_EMBEDDINGS = {
  id: "002_embeddings",
  description:
    "pgvector extension, document_chunks table, per-project embeddings toggle",
  sql: `
    CREATE EXTENSION IF NOT EXISTS vector;

    ALTER TABLE projects
      ADD COLUMN embeddings_enabled BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE TABLE document_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      heading_path JSONB NOT NULL DEFAULT '[]'::jsonb,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding VECTOR(1536) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
    CREATE INDEX idx_document_chunks_embedding
      ON document_chunks USING hnsw (embedding vector_cosine_ops);
  `,
};
