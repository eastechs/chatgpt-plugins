import type { PGlite } from "@electric-sql/pglite";

interface Migration {
  id: string;
  description: string;
  sql: string;
}

// Each migration runs exactly once per database, tracked in `_migrations`.
//
// Rules of engagement:
//   - Migrations are applied in array order. Don't reorder them.
//   - Once a migration is in use, NEVER edit it. Add a new one.
//   - Each id must be unique. Zero-padded numeric prefixes keep the array
//     visually sorted.
//   - Each migration's SQL runs inside a transaction so a partial failure
//     rolls back and leaves the migration unmarked.
const MIGRATIONS: Migration[] = [
  {
    id: "001_initial",
    description: "Initial schema",
    sql: `
      CREATE TABLE items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  // Add new migrations below. Never edit ones above.
];

export async function runMigrations(pglite: PGlite): Promise<void> {
  // The tracking table must exist before we can read applied migrations.
  // Ironically the only "always-runs" SQL — bootstraps everything else.
  await pglite.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await pglite.query<{ id: string }>(
    "SELECT id FROM _migrations",
  );
  const appliedIds = new Set(applied.rows.map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    console.log(
      `[migrations] Applying ${migration.id}: ${migration.description}`,
    );

    await pglite.transaction(async (tx) => {
      // tx.exec runs multiple SQL statements (PGLite's transaction API,
      // analogous to psql -c). Single statements use tx.query instead.
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO _migrations (id) VALUES ($1)", [
        migration.id,
      ]);
    });
  }
}
