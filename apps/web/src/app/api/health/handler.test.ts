import { describe, expect, it, vi } from 'vitest';
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

  it('logs only a fixed category, never the driver message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const secret = 'postgres://lzp_app:hunter2@db.internal:5432/letzeuspost';
      await createHealthHandler(
        dbThat(() => Promise.reject(new Error(`cannot reach ${secret}`))),
      )();
      await createHealthHandler(
        dbThat(() => new Promise<void>(() => undefined)),
        {
          timeoutMs: 20,
        },
      )();
      const logged = log.mock.calls.map((args) => args.map(String).join(' '));
      expect(logged).toEqual([
        'health: the database did not answer (error)',
        'health: the database did not answer (timeout)',
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it('shares one running ping between requests, so a flood does not queue pings', async () => {
    let calls = 0;
    let finish: () => void = () => undefined;
    const slow = dbThat(() => {
      calls += 1;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const handler = createHealthHandler(slow);
    const flood = Array.from({ length: 25 }, () => handler());
    finish();
    const responses = await Promise.all(flood);
    expect(calls).toBe(1);
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 25 }, () => 200));
    // The bodies are separate responses: reading one does not use up the others.
    expect(await responses[0]?.json()).toEqual({ status: 'ok' });
    expect(await responses[24]?.json()).toEqual({ status: 'ok' });
  });

  it('pings again once the running ping is over, so a recovered database is seen', async () => {
    let calls = 0;
    const flaky = dbThat(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve();
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const handler = createHealthHandler(flaky);
      expect((await handler()).status).toBe(503);
      expect((await handler()).status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      log.mockRestore();
    }
  });

  it('is never cached, so a recovered database is seen at once', async () => {
    const up = await createHealthHandler(dbThat(() => Promise.resolve()))();
    const down = await createHealthHandler(dbThat(() => Promise.reject(new Error('x'))))();
    expect(up.headers.get('cache-control')).toBe('no-store');
    expect(down.headers.get('cache-control')).toBe('no-store');
  });
});
