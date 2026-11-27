// `seed:dev`'s brands (#411, §17 Test data): Northwind Social's 3 sample brands, saved the way the app saves a brand,
// through `brandKits(db, BrandKitSchema)`: `createBrand` under the plan's brand limit, then `saveKit`, which checks the
// kit and writes it as version 1. With `logos` (apps/worker's `seed:dev`, #443), each brand still at that version 1
// then gets its logo assets and a second version that names them (logos.ts); without it (this package's own entry,
// dev.ts), the brands keep version 1 until a run with `logos` gives them theirs.
//
// A brand is found by its English name in the seed's workspace: the owner role isn't bound by row-level security, so
// the lookup names the workspace itself, and another workspace's brand is never skipped or saved to. One that is
// missing is added; one with no kit yet (a run that stopped between the two steps) gets its kit; one with a kit is left
// as it is, so a second run changes nothing, and a kit edited in the app is never overwritten. The steps are separate
// transactions (as in the app), so the whole run holds the seeds' advisory lock on a connection of its own: two runs at
// once take turns and add each brand once.
//
// db doesn't depend on @lzp/core (brand-kits.ts takes the schema as an argument), so the seed reaches core's kit schema
// and brand rule by path, as tests/tenancy/fixtures.ts does. It runs only in development and tests (`seed:dev`).
import { plans } from '@lzp/config';
import { and, eq } from 'drizzle-orm';
import { BrandKitSchema } from '../../../core/src/index.ts';
import { canAddBrand } from '../../../core/src/quotas/index.ts';
import { brandKits } from '../brand-kits.ts';
import { checkedId, dbOnPool, openPool, type WorkspaceCtx } from '../db.ts';
import { brand } from '../schema/brands.ts';
import { seedBrandLogos, type SeedLogos } from './logos.ts';
import type { SampleBrand } from './sample-brands.ts';
import { SEED_LOCK } from './seed.ts';

/**
 * Northwind has no plan set; its 3 brands are the Starter plan's limit (config/plans.ts), the smallest plan that holds
 * them, so the seed is held to the same rule the app is.
 */
const allowed = (brandsNow: number) => canAddBrand(plans.starter, brandsNow);

/**
 * Adds what is missing of `samples` to the workspace, with their logos when `logos` says how to add them, and says
 * whether it changed anything.
 */
export async function seedBrands(
  ownerUrl: string,
  ctx: WorkspaceCtx,
  samples: readonly SampleBrand[],
  logos?: SeedLogos,
): Promise<{ changed: boolean }> {
  const workspaceId = checkedId('workspace', ctx.workspaceId);
  const pool = openPool(ownerUrl);
  try {
    const lock = await pool.connect();
    try {
      await lock.query('select pg_advisory_lock($1)', [SEED_LOCK]);
      const db = dbOnPool(pool);
      const kits = brandKits(db, BrandKitSchema);
      let changed = false;
      for (const sample of samples) {
        const [found] = await db.forWorkspace(ctx).transaction((tx) =>
          tx
            .select({ id: brand.id, kitVersion: brand.currentKitVersion })
            .from(brand)
            .where(and(eq(brand.workspaceId, workspaceId), eq(brand.nameEn, sample.nameEn)))
            .limit(1),
        );
        let target: { id: string; kitVersion: number };
        if (found !== undefined && found.kitVersion !== null) {
          target = { id: found.id, kitVersion: found.kitVersion };
        } else {
          const { id } =
            found ??
            (await kits.createBrand(
              ctx,
              { nameEn: sample.nameEn, nameBn: sample.nameBn },
              allowed,
            ));
          const { version } = await kits.saveKit(ctx, id, sample.kit);
          target = { id, kitVersion: version };
          changed = true;
        }
        if (
          logos !== undefined &&
          (await seedBrandLogos(db, kits, ctx, { ...target, sample }, logos))
        ) {
          changed = true;
        }
      }
      return { changed };
    } finally {
      // Closing the lock's connection ends its session, and the lock with it, whatever happened above.
      lock.release(true);
    }
  } finally {
    await pool.end();
  }
}
