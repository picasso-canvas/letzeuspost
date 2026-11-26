// `seed:dev`'s brands (#411, §17 Test data): Northwind Social's 3 sample brands, saved the way the app saves a brand,
// through `brandKits(db, BrandKitSchema)`: `createBrand` under the plan's brand limit, then `saveKit`, which checks the
// kit and writes it as version 1. No logo assets: they need the file store, and come in a follow-up task.
//
// A brand is found by its English name. One that is missing is added; one with no kit yet (a run that stopped between
// the two steps) gets its kit; one with a kit is left as it is, so a second run changes nothing, and a kit edited in
// the app is never overwritten. The steps are separate transactions (as in the app), so the whole run holds the seeds'
// advisory lock on a connection of its own: two runs at once take turns and add each brand once.
//
// db doesn't depend on @lzp/core (brand-kits.ts takes the schema as an argument), so the seed reaches core's kit schema
// and brand rule by path, as tests/tenancy/fixtures.ts does. It runs only in development and tests (`seed:dev`).
import { plans } from '@lzp/config';
import { eq } from 'drizzle-orm';
import { BrandKitSchema } from '../../../core/src/index.ts';
import { canAddBrand } from '../../../core/src/quotas/index.ts';
import { brandKits } from '../brand-kits.ts';
import { dbOnPool, openPool, type WorkspaceCtx } from '../db.ts';
import { brand } from '../schema/brands.ts';
import type { SampleBrand } from './sample-brands.ts';
import { SEED_LOCK } from './seed.ts';

/**
 * Northwind has no plan set; its 3 brands are the Starter plan's limit (config/plans.ts), the smallest plan that holds
 * them, so the seed is held to the same rule the app is.
 */
const allowed = (brandsNow: number) => canAddBrand(plans.starter, brandsNow);

/** Adds what is missing of `samples` to the workspace, and says whether it changed anything. */
export async function seedBrands(
  ownerUrl: string,
  ctx: WorkspaceCtx,
  samples: readonly SampleBrand[],
): Promise<{ changed: boolean }> {
  const pool = openPool(ownerUrl);
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [SEED_LOCK]);
    const db = dbOnPool(pool);
    const kits = brandKits(db, BrandKitSchema);
    let changed = false;
    for (const sample of samples) {
      const [found] = await db
        .forWorkspace(ctx)
        .transaction((tx) =>
          tx
            .select({ id: brand.id, kitVersion: brand.currentKitVersion })
            .from(brand)
            .where(eq(brand.nameEn, sample.nameEn))
            .limit(1),
        );
      if (found !== undefined && found.kitVersion !== null) continue;
      const { id } =
        found ??
        (await kits.createBrand(ctx, { nameEn: sample.nameEn, nameBn: sample.nameBn }, allowed));
      await kits.saveKit(ctx, id, sample.kit);
      changed = true;
    }
    return { changed };
  } finally {
    // Closing the lock's connection ends its session, and the lock with it, whatever happened above.
    lock.release(true);
    await pool.end();
  }
}
