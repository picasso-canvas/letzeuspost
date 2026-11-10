// `pnpm --filter @lzp/db migrate` (../bin/migrate.ts) installs pg-boss as the owner role, right after the migrations
// (Athena's decision on #72, 2026-11-10), so a fresh deploy's worker finds the `pgboss` schema it needs, owned by the
// owner role and never installed by the app role. jobs.int.test.ts runs the real command against Postgres.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_URL = 'postgres://lzp_owner@127.0.0.1:5432/lzp';
const steps: string[] = [];

vi.mock('@lzp/config', () => ({
  loadEnv: (process: string) => {
    steps.push(`loadEnv ${process}`);
    return { DATABASE_OWNER_URL: OWNER_URL };
  },
}));
vi.mock('../migrate.ts', () => ({
  migrate: (url: string) => {
    steps.push(`migrate ${url}`);
    return Promise.resolve();
  },
}));
vi.mock('./boss.ts', () => ({
  installJobs: (url: string) => {
    steps.push(`installJobs ${url}`);
    return Promise.resolve();
  },
}));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('the migrate command', () => {
  it('runs the migrations, then installs pg-boss once, both as the owner role', async () => {
    await import('../bin/migrate.ts');
    expect(steps).toEqual(['loadEnv migrate', `migrate ${OWNER_URL}`, `installJobs ${OWNER_URL}`]);
  });
});
