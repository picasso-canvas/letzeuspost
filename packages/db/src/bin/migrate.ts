// `pnpm --filter @lzp/db migrate`: the migrations, then pg-boss in its `pgboss` schema, both as the owner role, so the
// app role only ever uses the queue's tables (#72). Reads only DATABASE_OWNER_URL (config/env.ts's `migrate` process)
// and stops with a clear error if it's missing or malformed.
import { loadEnv } from '@lzp/config';
import { installJobs } from '../jobs/boss.ts';
import { migrate } from '../migrate.ts';

const { DATABASE_OWNER_URL } = loadEnv('migrate');
await migrate(DATABASE_OWNER_URL);
await installJobs(DATABASE_OWNER_URL);
console.log('Migrations applied.');
