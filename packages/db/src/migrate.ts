// Runs the migrations in ../migrations, as the owner role (DATABASE_OWNER_URL, which the app never holds). Applied
// migrations are recorded in the `drizzle` schema, so running this again changes nothing.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** An advisory lock held while migrating, so two runs at once take turns. Any fixed number; this one is the task's. */
const MIGRATION_LOCK = 71;

/**
 * Where the migrations come from and where they're recorded. Only migrate.int.test.ts sets these, to run the migrator
 * on a throwaway folder; the deploy uses the defaults (this package's migrations, recorded in the `drizzle` schema).
 */
export interface MigrateOptions {
  migrationsFolder?: string;
  migrationsSchema?: string;
}

export async function migrate(ownerUrl: string, options: MigrateOptions = {}): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK]);
    // drizzle-orm 0.45's migrator runs all pending files in one transaction, so a file that fails partway leaves
    // nothing applied: CI's squawk relies on that (assume_in_transaction), and migrate.int.test.ts checks it.
    await applyMigrations(drizzle({ client }), { migrationsFolder, ...options });
  } finally {
    await client.end(); // ending the session releases the lock
  }
}
