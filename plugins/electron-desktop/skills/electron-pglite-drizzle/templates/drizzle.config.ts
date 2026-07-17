import { defineConfig } from "drizzle-kit";

// This config is only used by drizzle-kit (CLI) for type generation —
// e.g. `drizzle-kit generate` to produce migration SQL from schema diffs.
// At runtime, migrations.ts owns the apply path. Don't reference this file
// from runtime code.
export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
