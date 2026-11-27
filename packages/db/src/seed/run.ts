// A seed run on its own connection: what `seed:studio` and `seed:dev` do, and what the end-to-end tests do to seed the
// people they sign in as (tests/e2e/workspaces.spec.ts). `ownerUrl` is the owner role's (DATABASE_OWNER_URL), the only
// role that may set the platform-admin flag; the connection is closed again whatever happens.
import { drizzle } from 'drizzle-orm/node-postgres';
import { openPool } from '../db.ts';
import { seedBrands } from './brands.ts';
import { sampleBrands } from './sample-brands.ts';
import { devSeed, seedWorkspace, type Seed } from './seed.ts';

/** A workspace and its people (`seed:studio`, and the journeys' workspaces): no brands. */
export async function runSeed(
  ownerUrl: string,
  seed: Seed,
): Promise<{ changed: boolean; workspaceId: string }> {
  const pool = openPool(ownerUrl);
  try {
    return await seedWorkspace(drizzle({ client: pool }), seed);
  } finally {
    await pool.end();
  }
}

/** `seed:dev`: Northwind Social and its people, then its 3 sample brands (#411). */
export async function runDevSeed(
  ownerUrl: string,
  seed: Seed = devSeed(),
): Promise<{ changed: boolean }> {
  const workspace = await runSeed(ownerUrl, seed);
  const brands = await seedBrands(ownerUrl, { workspaceId: workspace.workspaceId }, sampleBrands());
  return { changed: workspace.changed || brands.changed };
}
