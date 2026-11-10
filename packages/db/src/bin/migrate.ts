// `pnpm --filter @lzp/db migrate`: the migrations, as the owner role. Reads only DATABASE_OWNER_URL (config/env.ts's
// `migrate` process) and stops with a clear error if it's missing or malformed.
import { loadEnv } from '@lzp/config';
import { migrate } from '../migrate.ts';

const { DATABASE_OWNER_URL } = loadEnv('migrate');
await migrate(DATABASE_OWNER_URL);
console.log('Migrations applied.');
