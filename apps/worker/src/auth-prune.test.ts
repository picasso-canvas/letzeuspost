import { randomUUIDv7 } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PRUNE_EVERY_MS, authPrune, scheduleAuthPrune } from './auth-prune.ts';
import type { LogFields } from './log.ts';

const runId = randomUUIDv7();

/** An error whose message quotes what a log must never hold: an address and a bucket key. */
class LockNotAvailable extends Error {
  override name = 'LockNotAvailable';
}
const quoting = () =>
  new LockNotAvailable(
    'canceling statement: delete from rate_limit_hit where bucket = sign-in:address:9f86d081 for nadia@agency.test',
  );

describe("the auth tables' prune (#323)", () => {
  it('prunes both tables and logs the counts alone', async () => {
    const lines: { event: string; fields: LogFields }[] = [];
    await authPrune({
      prune: {
        rateLimitHits: () => Promise.resolve(42),
        accountEmails: () => Promise.resolve(3),
      },
      log: (event, fields = {}) => lines.push({ event, fields }),
    })({ runId });

    expect(lines).toEqual([
      { event: 'auth.pruned', fields: { runId, rateLimitHits: 42, accountEmails: 3, failed: 0 } },
    ]);
  });

  it('still prunes the other table when one fails, logs the failure by its error name only, then rejects', async () => {
    const lines: { event: string; fields: LogFields }[] = [];
    const run = authPrune({
      prune: {
        rateLimitHits: () => Promise.reject(quoting()),
        accountEmails: () => Promise.resolve(7),
      },
      log: (event, fields = {}) => lines.push({ event, fields }),
    })({ runId });

    const rejected = await run.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).not.toMatch(/nadia|sign-in:|rate_limit_hit where/);
    expect(lines).toEqual([
      {
        event: 'auth.prune-table-failed',
        fields: { runId, table: 'rate_limit_hit', error: 'LockNotAvailable' },
      },
      { event: 'auth.pruned', fields: { runId, accountEmails: 7, failed: 1 } },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/nadia|9f86d081/);
  });
});

describe("the auth prune's timer (#323)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs every AUTH_PRUNE_EVERY_MS, the first one interval after the start', async () => {
    const runs: string[] = [];
    const timer = scheduleAuthPrune(
      ({ runId: id }) => {
        runs.push(id);
        return Promise.resolve();
      },
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(AUTH_PRUNE_EVERY_MS - 1);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AUTH_PRUNE_EVERY_MS);
    expect(runs).toHaveLength(2);
    expect(new Set(runs).size).toBe(2);
    await timer.stop();
  });

  it('logs a failed run by its error name only, and the next run still comes', async () => {
    const lines: { event: string; fields: LogFields }[] = [];
    const runs: string[] = [];
    const timer = scheduleAuthPrune(
      ({ runId: id }) => {
        runs.push(id);
        return Promise.reject(quoting());
      },
      (event, fields = {}) => lines.push({ event, fields }),
    );
    await vi.advanceTimersByTimeAsync(AUTH_PRUNE_EVERY_MS * 2);
    expect(lines).toEqual(
      runs.map((id) => ({
        event: 'auth.prune-failed',
        fields: { runId: id, error: 'LockNotAvailable' },
      })),
    );
    expect(runs).toHaveLength(2);
    await timer.stop();
  });
});
