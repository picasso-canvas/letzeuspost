// `seed:dev`'s entry (#443): it lives in apps/worker, beside @lzp/storage, which packages/db can't import (storage
// depends on db), and the repository's `seed:dev` runs it. config/env.ts's `seed-dev` process holds the owner role's
// URL and the file store's settings, and none of another process's other settings (§13 What runs, §14 Secrets).
import { readFileSync } from 'node:fs';
import { loadEnv } from '@lzp/config';
import { describe, expect, it } from 'vitest';

const root = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as {
  scripts?: Record<string, string>;
};

describe('seed:dev (#443)', () => {
  it('runs apps/worker’s seed entry from the repository root, on plain Node as the worker runs', () => {
    expect(root.scripts?.['seed:dev']).toBe('node apps/worker/src/seed-dev.ts');
    expect(readFileSync(new URL('seed-dev.ts', import.meta.url), 'utf8')).toContain(
      "loadEnv('seed-dev')",
    );
  });

  it('gets the owner role and the file store, and nothing else of the web’s or the worker’s settings', () => {
    const seed = {
      LZP_ENV: 'development',
      DATABASE_OWNER_URL: 'postgres://owner:secret@localhost:5432/letzeuspost',
      STORAGE_ENDPOINT: 'http://localhost:8333',
      STORAGE_REGION: 'us-east-1',
      STORAGE_BUCKET: 'letzeuspost',
      STORAGE_ACCESS_KEY_ID: 'dev-key',
      STORAGE_SECRET_ACCESS_KEY: 'dev-secret',
    };
    const others = {
      DATABASE_URL: 'postgres://app:secret@localhost:5432/letzeuspost',
      SMTP_URL: 'smtp://localhost:1025',
      EMAIL_FROM: 'hello@letzeuspost.invalid',
      AUTH_SECRET: 'a'.repeat(32),
      APP_URL: 'http://localhost:3000',
    };
    expect(loadEnv('seed-dev', { ...seed, ...others })).toEqual(seed);
  });
});
