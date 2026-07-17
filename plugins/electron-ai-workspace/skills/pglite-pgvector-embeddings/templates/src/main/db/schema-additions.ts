// MERGE: add these to src/main/db/schema.ts.
// They reference your existing `projects` and `documents` tables; rename
// imports/relations to match your schema.

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";
// REPLACE: import path to your existing tables.
// import { documents } from "./schema.js";

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  headingPath: jsonb("heading_path").$type<string[]>().notNull().default([]),
  text: text("text").notNull(),
  tokenCount: integer("token_count").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// REPLACE: also add this column to your existing `projects` table:
//   embeddingsEnabled: boolean("embeddings_enabled").notNull().default(true),
