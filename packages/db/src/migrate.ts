// Runs the migrations in ../migrations, as the owner role (DATABASE_OWNER_URL, which the app never holds). Applied
// migrations are recorded in the `drizzle` schema, so running this again changes nothing.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** An advisory lock held while migrating, so two runs at once take turns. Any fixed number; this one is the task's. */
const MIGRATION_LOCK = 71;

export async function migrate(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK]);
    await applyMigrations(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end(); // ending the session releases the lock
  }
}
