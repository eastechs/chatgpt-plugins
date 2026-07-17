import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// REPLACE: shape this to your domain. The starter `items` table is here so
// the runner has something to apply on first launch — delete it once you've
// added real tables (or keep migration 001 as a no-op-equivalent and add
// real schema in 002+).
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
