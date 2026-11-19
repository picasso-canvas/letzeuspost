// `pnpm --filter @lzp/db seed:dev`: Northwind Social, the sample agency for development and tests (#79, Q14, §17), with
// its owner and an editor; its 3 brands come with M2. Refused in production. Runs as the owner role
// (DATABASE_OWNER_URL, config/env.ts's `seed` process). A second run changes nothing.
import { loadEnv } from '@lzp/config';
import { runSeed } from './run.ts';
import { devSeed, refuseDevSeedIn } from './seed.ts';

const { LZP_ENV, DATABASE_OWNER_URL } = loadEnv('seed');
refuseDevSeedIn(LZP_ENV);
const seed = devSeed();
const { changed } = await runSeed(DATABASE_OWNER_URL, seed);
console.log(
  changed
    ? `${seed.workspace.name} is ready: ${seed.people.map((p) => `${p.name} (${p.role})`).join(', ')}.`
    : `${seed.workspace.name} was already there: nothing changed.`,
);
