// MERGE: append to your src/main/db/schema.ts.

import { pgTable, uuid, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

// REPLACE: import your existing `projects` table here, or remove the
// projectId column if your conversations don't belong to a project.
// import { projects } from "./schema.js";

// ─── Conversations ─────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  title: text("title").default("New Chat").notNull(),
  side: text("side"),
  model: text("model"),
  // Reasoning effort for this conversation. Sticky once changed: default
  // 'medium' on creation, the user can dial it via the prompt input dropdown
  // and the new value persists for follow-up messages until they change it.
  effort: text("effort").notNull().default("medium"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Messages (UIMessage-native format) ────────────────────
//
// Stores messages in Vercel AI SDK's UIMessage format directly.
// The `parts` column is a JSONB array preserving tool call ordering:
//
//   [
//     { "type": "text", "text": "Let me create that..." },
//     { "type": "tool-invocation", "toolCallId": "abc", "toolName": "...",
//       "state": "output-available", "input": {...}, "output": {...} },
//     { "type": "text", "text": "Done!" }
//   ]
//
// No reconstruction or stitching needed — load from DB, send to frontend.

export const messages = pgTable("messages", {
  id: text("id").primaryKey(), // UIMessage.id — client-generated for user, server-generated for assistant
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  parts: jsonb("parts").notNull(), // UIMessage.parts[] — ordered array
  metadata: jsonb("metadata"), // usage stats, model info, etc.
  orderIndex: integer("order_index").notNull(), // explicit ordering within conversation
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
