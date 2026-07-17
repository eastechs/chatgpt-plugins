// MERGE: append this entry to the MIGRATIONS array in src/main/db/migrations.ts.

export const MIGRATION_CHAT_TABLES = {
  id: "001_chat_tables",
  description: "Conversations and UIMessage-native messages tables",
  sql: `
    CREATE TABLE conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      side TEXT,
      model TEXT,
      effort TEXT NOT NULL DEFAULT 'medium',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      parts JSONB NOT NULL,
      metadata JSONB,
      order_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_conversations_project ON conversations(project_id);
    CREATE INDEX idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX idx_messages_order ON messages(conversation_id, order_index);
  `,
};
