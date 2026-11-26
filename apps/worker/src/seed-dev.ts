// `pnpm seed:dev`: Northwind Social, the sample agency for development and tests (#79, Q14, §17), with its owner and an
// editor, its 3 sample brands with full kits (#411), and their logos (#443): each logo file put in the bucket and added
// to its brand's library as an upload adds it (seed-logos.ts), and each kit's second version naming them. The worker's
// `asset` job then processes them like any upload; nothing here marks one ready. Refused in production. Runs as
// config/env.ts's `seed` process: the owner role (DATABASE_OWNER_URL) and the file store, nothing else. A second run
// changes nothing.
//
// The entry lives in apps/worker, beside @lzp/storage, which packages/db can't import (storage depends on db); the
// brands and kits are still packages/db's seed, reached by path as the worker's tests reach other packages' sources.
import { loadEnv } from '@lzp/config';
import { createDb, createJobs } from '@lzp/db';
import { createStorage } from '@lzp/storage';
import { runDevSeed } from '../../../packages/db/src/seed/run.ts';
import { sampleBrands } from '../../../packages/db/src/seed/sample-brands.ts';
import { devSeed, refuseDevSeedIn } from '../../../packages/db/src/seed/seed.ts';
import { addLogoAsUploaded } from './seed-logos.ts';

const env = loadEnv('seed');
refuseDevSeedIn(env.LZP_ENV);
const seed = devSeed();
const storage = createStorage(env);
const db = createDb(env.DATABASE_OWNER_URL);
const jobs = createJobs({
  url: env.DATABASE_OWNER_URL,
  db,
  // pg-boss's own failures, by kind: its messages may quote a statement, so they stay out of the output.
  onError: (error) => {
    console.error(`seed: jobs error ${error.name} ${String((error as { code?: string }).code)}`);
  },
});
let changed: boolean;
try {
  await jobs.start();
  ({ changed } = await runDevSeed(
    env.DATABASE_OWNER_URL,
    seed,
    addLogoAsUploaded({ storage, db, jobs }),
  ));
} finally {
  await jobs.stop();
  await db.close();
  storage.close();
}
const people = seed.people.map((p) => `${p.name} (${p.role})`).join(', ');
const brands = sampleBrands()
  .map((brand) => brand.nameEn)
  .join(', ');
console.log(
  changed
    ? `${seed.workspace.name} is ready: ${people}; brands ${brands}, with their logos (the worker processes them).`
    : `${seed.workspace.name} was already there: nothing changed.`,
);
