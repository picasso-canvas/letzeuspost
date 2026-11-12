// A seed run on its own connection: what `seed:studio` and `seed:dev` do, and what the end-to-end tests do to seed the
// people they sign in as (tests/e2e/workspaces.spec.ts). `ownerUrl` is the owner role's (DATABASE_OWNER_URL), the only
// role that may set the platform-admin flag; the connection is closed again whatever happens.
import { drizzle } from 'drizzle-orm/node-postgres';
import { openPool } from '../db.ts';
import { seedWorkspace, type Seed } from './seed.ts';

export async function runSeed(ownerUrl: string, seed: Seed): Promise<{ changed: boolean }> {
  const pool = openPool(ownerUrl);
  try {
    return await seedWorkspace(drizzle({ client: pool }), seed);
  } finally {
    await pool.end();
  }
}
