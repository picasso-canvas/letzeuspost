import { randomUUIDv7 } from 'node:crypto';
import { SENDING_STALE_AFTER_SECONDS, type Db, type Scoped } from '@lzp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  EMAIL_SWEEP_EVERY_MS,
  emailSweep,
  scheduleEmailSweep,
  type EmailSweep,
} from './email-sweep.ts';
import type { LogFields } from './log.ts';

const runId = randomUUIDv7();
const job = { runId };

/** A database whose scoped handles say which workspace they were opened for. */
function fakeDb() {
  const opened: string[] = [];
  const handles = new Map<Scoped, string>();
  const db: Db = {
    forWorkspace: ({ workspaceId }) => {
      opened.push(workspaceId);
      const scoped: Scoped = { transaction: () => Promise.reject(new Error('not here')) };
      handles.set(scoped, workspaceId);
      return scoped;
    },
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { db, opened, workspaceOf: (scoped: Scoped) => handles.get(scoped) };
}

describe('the email outbox sweep (#210)', () => {
  it("marks each failed email job's workspace's stale rows interrupted, through that workspace's own handle", async () => {
    const [a, b] = [randomUUIDv7(), randomUUIDv7()];
    const rows = new Map<string, string[]>([
      [a, [randomUUIDv7(), randomUUIDv7()]],
      [b, []],
    ]);
    const { db, opened, workspaceOf } = fakeDb();
    const asked: string[] = [];
    const swept: (string | undefined)[] = [];
    const lines: { event: string; fields: LogFields }[] = [];

    await emailSweep({
      db,
      jobs: {
        failedWorkspaces: (queue) => {
          asked.push(queue);
          return Promise.resolve([a, b]);
        },
      },
      interrupt: (scoped) => {
        const workspaceId = workspaceOf(scoped);
        swept.push(workspaceId);
        return Promise.resolve(rows.get(workspaceId ?? '') ?? []);
      },
      log: (event, fields = {}) => lines.push({ event, fields }),
    })(job);

    expect(asked).toEqual(['email']);
    expect(opened).toEqual([a, b]);
    expect(swept).toEqual([a, b]);
    expect(lines).toEqual([
      ...(rows.get(a) ?? []).map((emailMessageId) => ({
        event: 'email.interrupted',
        fields: { runId, workspaceId: a, emailMessageId },
      })),
      { event: 'email.swept', fields: { runId, workspaces: 2, interrupted: 2, failed: 0 } },
    ]);
  });

  it('does nothing but say so when no email job has failed', async () => {
    const { db, opened } = fakeDb();
    const lines: string[] = [];
    await emailSweep({
      db,
      jobs: { failedWorkspaces: () => Promise.resolve([]) },
      interrupt: () => Promise.reject(new Error('no workspace to sweep')),
      log: (event) => lines.push(event),
    })(job);
    expect(opened).toEqual([]);
    expect(lines).toEqual(['email.swept']);
  });

  it('sweeps the other workspaces when one fails, logs it by id and error name only, then rejects the run', async () => {
    const [a, b, c] = [randomUUIDv7(), randomUUIDv7(), randomUUIDv7()];
    const rowOfC = randomUUIDv7();
    const { db, workspaceOf } = fakeDb();
    const swept: (string | undefined)[] = [];
    const lines: { event: string; fields: LogFields }[] = [];

    const run = emailSweep({
      db,
      jobs: { failedWorkspaces: () => Promise.resolve([a, b, c]) },
      interrupt: (scoped) => {
        const workspaceId = workspaceOf(scoped);
        swept.push(workspaceId);
        if (workspaceId === b) {
          class LockNotAvailable extends Error {
            override name = 'LockNotAvailable';
          }
          return Promise.reject(
            new LockNotAvailable(
              'canceling statement: update "email_message" for nadia@agency.test',
            ),
          );
        }
        return Promise.resolve(workspaceId === c ? [rowOfC] : []);
      },
      log: (event, fields = {}) => lines.push({ event, fields }),
    })(job);

    const rejected = await run.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).not.toMatch(/nadia|email_message|update/);
    expect(swept).toEqual([a, b, c]);
    expect(lines).toEqual([
      {
        event: 'email.sweep-workspace-failed',
        fields: { runId, workspaceId: b, error: 'LockNotAvailable' },
      },
      { event: 'email.interrupted', fields: { runId, workspaceId: c, emailMessageId: rowOfC } },
      { event: 'email.swept', fields: { runId, workspaces: 3, interrupted: 1, failed: 1 } },
    ]);
  });

  it('rejects the run when listing the workspaces fails', async () => {
    const { db, opened } = fakeDb();
    await expect(
      emailSweep({
        db,
        jobs: {
          failedWorkspaces: () => Promise.reject(new Error('Connection terminated unexpectedly')),
        },
        interrupt: () => Promise.resolve([]),
        log: () => undefined,
      })(job),
    ).rejects.toThrow('Connection terminated unexpectedly');
    expect(opened).toEqual([]);
  });
});

describe("the email sweep's timer (#210, Zeus's option D on #322)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A sweep whose runs the test ends: each call waits until `finish` is called. */
  function heldSweep() {
    const runs: string[] = [];
    const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
    const sweep: EmailSweep = ({ runId: id }) => {
      runs.push(id);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    return { sweep, runs, pending };
  }

  it('runs the sweep every EMAIL_SWEEP_EVERY_MS, each run named by a new id, and not at once', async () => {
    const runs: string[] = [];
    const timer = scheduleEmailSweep(
      ({ runId: id }) => {
        runs.push(id);
        return Promise.resolve();
      },
      () => undefined,
    );

    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS - 1);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS);
    expect(runs).toHaveLength(2);
    expect(new Set(runs).size).toBe(2);
    for (const id of runs) expect(z.uuidv7().safeParse(id).success).toBe(true);
    await timer.stop();
  });

  it('sweeps often enough to catch a row soon after its staleness window', () => {
    expect(EMAIL_SWEEP_EVERY_MS).toBeGreaterThan(0);
    expect(EMAIL_SWEEP_EVERY_MS).toBeLessThan(SENDING_STALE_AFTER_SECONDS * 1000);
  });

  it('never starts a run while the last one is still going', async () => {
    const { sweep, runs, pending } = heldSweep();
    const timer = scheduleEmailSweep(sweep, () => undefined);

    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS * 3);
    expect(runs).toHaveLength(1);
    pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS);
    expect(runs).toHaveLength(2);
    pending[1]?.resolve();
    await timer.stop();
  });

  it('logs a failed run by its error name only, and the next run still comes', async () => {
    const { sweep, runs, pending } = heldSweep();
    const lines: { event: string; fields: LogFields }[] = [];
    const timer = scheduleEmailSweep(sweep, (event, fields = {}) => lines.push({ event, fields }));

    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS);
    pending[0]?.reject(new TypeError('relation "email_message" for nadia@agency.test'));
    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS);

    expect(lines).toEqual([
      { event: 'email.sweep-failed', fields: { runId: runs[0], error: 'TypeError' } },
    ]);
    expect(runs).toHaveLength(2);
    pending[1]?.resolve();
    await timer.stop();
  });

  it('stops: no run after stop, and stop waits for the run in flight', async () => {
    const { sweep, runs, pending } = heldSweep();
    const timer = scheduleEmailSweep(sweep, () => undefined);
    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS);

    let stopped = false;
    const stopping = timer.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    pending[0]?.resolve();
    await stopping;
    expect(stopped).toBe(true);

    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS * 3);
    expect(runs).toHaveLength(1);
  });

  it('stops at once when no run is going', async () => {
    const { sweep, runs } = heldSweep();
    const timer = scheduleEmailSweep(sweep, () => undefined);
    await timer.stop();
    await vi.advanceTimersByTimeAsync(EMAIL_SWEEP_EVERY_MS * 3);
    expect(runs).toHaveLength(0);
  });
});
