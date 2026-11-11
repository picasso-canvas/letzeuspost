// The health check against real Postgres: `ping()` from packages/db answers, so the route says 200; a database that
// can't be reached makes it say 503. Runs in `pnpm check:services` and CI's `services` job (the `.int.test.ts` name).
import { loadEnv } from '@lzp/config';
import { createDb } from '@lzp/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createHealthHandler } from './handler.ts';

const { DATABASE_URL: url } = loadEnv('web');
const up = createDb(url);
// Nothing listens on port 1: the connection is refused at once.
const down = createDb('postgres://lzp_app:unused@127.0.0.1:1/letzeuspost');

afterAll(async () => {
  await Promise.all([up.close(), down.close()]);
});

describe('/api/health with a real database', () => {
  it('answers 200 when the database answers', async () => {
    const response = await createHealthHandler(() => up)();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503, and shows no connection detail, when the database cannot be reached', async () => {
    const response = await createHealthHandler(() => down)();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe('{"status":"unavailable"}');
    expect(body).not.toContain('127.0.0.1');
  });
});
