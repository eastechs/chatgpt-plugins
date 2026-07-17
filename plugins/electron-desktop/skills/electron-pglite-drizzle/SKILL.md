---
name: electron-pglite-drizzle
description: Use when an Electron app needs an embedded SQL database with type-safe queries and the option to add pgvector for embeddings later. Wires up PGLite (Postgres-in-WASM) with the vector extension loaded on construction, Drizzle for typed access, and a hand-rolled migration runner with a `_migrations` tracking table that applies each migration exactly once inside a transaction.
---

# electron-pglite-drizzle

PGLite + Drizzle inside Electron with the migration patterns the docs leave as an exercise. The migration runner is intentionally hand-rolled (not `drizzle-kit migrate` at runtime) — the rules-of-engagement comment at the top of `migrations.ts` is the institutional knowledge worth preserving.

## When to use

- App needs persistent structured data — relational, with foreign keys, indexes, transactions.
- You want embedded (single-process) — no separate Postgres process, no SQLite type-affinity quirks.
- You might want pgvector / full-text / JSONB later — PGLite supports all of it.
- You want compile-time typed queries — Drizzle.

PGLite stores its data dir under `app.getPath("userData")/pglite`, so it follows the user's OS conventions (macOS Application Support, Windows AppData, Linux XDG_DATA_HOME).

## What it scaffolds

| Source | Destination |
|---|---|
| `templates/src/main/database.ts` | `src/main/database.ts` — `initDatabase()` / `getDb()` singletons |
| `templates/src/main/db/migrations.ts` | `src/main/db/migrations.ts` — runner + array-of-migrations + rules-of-engagement comment |
| `templates/src/main/db/schema.ts` | `src/main/db/schema.ts` — Drizzle `pgTable` starter |
| `templates/drizzle.config.ts` | `drizzle.config.ts` — for `drizzle-kit generate` (type generation only, not runtime) |

## Decision points

- **Schema shape** — what tables does the app start with? The starter scaffolds an `items` table as a placeholder; replace with your domain.
- **Vector extension** — keep loaded by default. PGLite extensions have to be passed at construction time; you can't `CREATE EXTENSION` later if it wasn't loaded. Load it now even if you don't need it yet (`pglite-pgvector-embeddings` builds on this).
- **Migration prefix style** — zero-padded numeric (`001_initial`, `002_…`) is the convention. Don't mix numeric and date-based — sorts get weird across timezone boundaries.

## The migration runner

```typescript
const MIGRATIONS: Migration[] = [
  { id: "001_initial", description: "...", sql: `CREATE TABLE ...` },
  { id: "002_...",     description: "...", sql: `ALTER TABLE ...` },
];
```

`runMigrations(pglite)` does:
1. `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())` — bootstraps the tracking table itself.
2. Reads applied ids into a Set.
3. For each migration not in the Set: opens a transaction, runs the SQL, inserts the id into `_migrations`, commits. A failure rolls back so the migration stays unmarked and gets retried on next launch.

That's it. It's ~30 lines of code and handles every realistic case for a single-user desktop app's local DB.

## Rules of engagement (preserve these as comments in the file)

- **Migrations are applied in array order. Don't reorder them.** Reordering would change which migrations have already been applied per id, leading to drift.
- **Once a migration is in use, NEVER edit it. Add a new one.** Editing means user A's DB and user B's DB now agree on `_migrations` ids but disagree on actual schema.
- **Each id must be unique. Zero-padded numeric prefixes keep the array visually sorted.**
- **Each migration's SQL runs inside a transaction so a partial failure rolls back and leaves the migration unmarked.** Don't put DDL that can't run in a transaction (some `CREATE INDEX CONCURRENTLY` variants) here without splitting it out.

## Why hand-rolled instead of `drizzle-kit migrate`?

- `drizzle-kit` at runtime needs the kit installed in production — adds ~50 MB to the bundle.
- Generated migrations are SQL files that can be edited; the array-of-migrations pattern co-locates the id, description, and SQL in code so it can't drift.
- Embedding the SQL in TypeScript means migrations are part of the build artifact (no missing-files-at-runtime class of bug).

The included `drizzle.config.ts` is for `drizzle-kit generate` to produce type definitions only. Don't add `drizzle.config.ts` references to runtime code.

## Wiring it in

```typescript
// src/main/index.ts
import { initDatabase } from "./database.js";

app.whenReady().then(async () => {
  await initDatabase();   // runs migrations as part of init
  // ... rest of bootstrap
});
```

```typescript
// in any route handler / IPC handler / etc.
import { getDb } from "../database.js";
import { items } from "../db/schema.js";

const rows = await getDb().select().from(items);
```

## Source

Lifted from:
- [trident/src/main/database.ts](https://github.com/eastechs/trident/blob/main/src/main/database.ts)
- [trident/src/main/db/migrations.ts](https://github.com/eastechs/trident/blob/main/src/main/db/migrations.ts)
- [trident/src/main/db/schema.ts](https://github.com/eastechs/trident/blob/main/src/main/db/schema.ts)
