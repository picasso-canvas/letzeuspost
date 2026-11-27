// `pnpm --filter @lzp/db seed:dev`: Northwind Social, the sample agency for development and tests (#79, Q14, §17), with
// its owner and an editor, and its 3 sample brands with full kits (#411). Refused in production. Runs as the owner role
// (DATABASE_OWNER_URL, config/env.ts's `seed` process). A second run changes nothing.
import { loadEnv } from '@lzp/config';
import { runDevSeed } from './run.ts';
import { sampleBrands } from './sample-brands.ts';
import { devSeed, refuseDevSeedIn } from './seed.ts';

const { LZP_ENV, DATABASE_OWNER_URL } = loadEnv('seed');
refuseDevSeedIn(LZP_ENV);
const seed = devSeed();
const { changed } = await runDevSeed(DATABASE_OWNER_URL, seed);
const people = seed.people.map((p) => `${p.name} (${p.role})`).join(', ');
const brands = sampleBrands()
  .map((brand) => brand.nameEn)
  .join(', ');
console.log(
  changed
    ? `${seed.workspace.name} is ready: ${people}; brands ${brands}.`
    : `${seed.workspace.name} was already there: nothing changed.`,
);
