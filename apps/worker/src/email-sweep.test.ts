import { randomUUIDv7 } from 'node:crypto';
import type { Db, Scoped } from '@lzp/db';
import { describe, expect, it } from 'vitest';
import { emailSweep } from './email-sweep.ts';
import type { LogFields } from './log.ts';

const jobId = randomUUIDv7();
const job = { jobId };

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
        fields: { jobId, workspaceId: a, emailMessageId },
      })),
      { event: 'email.swept', fields: { jobId, workspaces: 2, interrupted: 2 } },
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

  it('rejects the run when a workspace could not be swept', async () => {
    const { db } = fakeDb();
    await expect(
      emailSweep({
        db,
        jobs: { failedWorkspaces: () => Promise.resolve([randomUUIDv7()]) },
        interrupt: () => Promise.reject(new Error('Connection terminated unexpectedly')),
        log: () => undefined,
      })(job),
    ).rejects.toThrow('Connection terminated unexpectedly');
  });
});
