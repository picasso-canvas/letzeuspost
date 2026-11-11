import { describe, expect, it } from 'vitest';
import { createHealthHandler } from './handler.ts';

const dbThat = (ping: () => Promise<void>) => () => ({ ping });

describe('the health check', () => {
  it('answers 200 when the database answers', async () => {
    const response = await createHealthHandler(dbThat(() => Promise.resolve()))();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 when the database fails', async () => {
    const down = dbThat(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')));
    const response = await createHealthHandler(down)();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('answers 503 when the app cannot even set up its database handle', async () => {
    const response = await createHealthHandler(() => {
      throw new Error('DATABASE_URL is missing');
    })();
    expect(response.status).toBe(503);
  });

  it('answers 503 when the database does not answer in time', async () => {
    const hangs = dbThat(() => new Promise<void>(() => undefined));
    const response = await createHealthHandler(hangs, { timeoutMs: 20 })();
    expect(response.status).toBe(503);
  });

  it('says nothing about the error, the database or any person', async () => {
    const secret = 'postgres://lzp_app:hunter2@db.internal:5432/letzeuspost';
    const down = dbThat(() => Promise.reject(new Error(`cannot reach ${secret}`)));
    const response = await createHealthHandler(down)();
    const body = await response.text();
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('db.internal');
    expect(Object.keys(JSON.parse(body) as object)).toEqual(['status']);
  });

  it('is never cached, so a recovered database is seen at once', async () => {
    const up = await createHealthHandler(dbThat(() => Promise.resolve()))();
    const down = await createHealthHandler(dbThat(() => Promise.reject(new Error('x'))))();
    expect(up.headers.get('cache-control')).toBe('no-store');
    expect(down.headers.get('cache-control')).toBe('no-store');
  });
});
