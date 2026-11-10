import { randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db.ts';
import { createJobs } from './boss.ts';
import { checkPayload, JobPayloadError, queueNames, queues } from './queues.ts';

const workspaceId = randomUUIDv7();
const emailMessageId = randomUUIDv7();

describe('the queues (§13 Jobs)', () => {
  it('declares the five queues', () => {
    expect([...queueNames].sort()).toEqual(['ai', 'email', 'export', 'fetch', 'render']);
  });

  it('accepts a payload of ids', () => {
    expect(checkPayload('email', { workspaceId, emailMessageId })).toEqual({
      workspaceId,
      emailMessageId,
    });
  });

  it.each([
    ['an email subject', { subject: 'Your posts are ready' }],
    ['Bangla post text', { caption: 'আমাদের নতুন মেনু' }],
    ['an email address', { to: 'nadia@example.com' }],
    ['a nested object', { meta: { id: emailMessageId } }],
  ])('refuses a payload carrying %s', (_, extra) => {
    expect(() => checkPayload('email', { workspaceId, emailMessageId, ...extra })).toThrow(
      JobPayloadError,
    );
  });

  it.each([
    ['text in an id', { workspaceId, emailMessageId: 'hello' }],
    ['a random (v4) UUID as an id', { workspaceId, emailMessageId: crypto.randomUUID() }],
    ['no workspace', { emailMessageId }],
    ['nothing at all', undefined],
  ])('refuses a payload with %s', (_, payload) => {
    expect(() => checkPayload('email', payload)).toThrow(JobPayloadError);
  });

  it("never repeats the refused payload's values in its error", () => {
    expect(() =>
      checkPayload('email', { workspaceId, emailMessageId, to: 'nadia@example.com' }),
    ).toThrow(/^(?![\s\S]*nadia)/);
  });

  it.each(queueNames)('makes every %s payload carry its workspace and ids only', (name) => {
    expect(() => checkPayload(name, { workspaceId, text: 'hello' })).toThrow(JobPayloadError);
    expect(() => checkPayload(name, {})).toThrow(JobPayloadError);
  });

  it.each(queueNames)('bounds the retries of %s, with backoff', (name) => {
    const { retryLimit, retryDelay, retryBackoff, retryDelayMax } = queues[name].queue;
    expect(retryLimit).toBeGreaterThanOrEqual(1);
    expect(retryLimit).toBeLessThanOrEqual(10);
    expect(retryDelay).toBeGreaterThan(0);
    expect(retryBackoff).toBe(true);
    expect(retryDelayMax).toBeGreaterThanOrEqual(retryDelay);
  });

  it('runs at most 4 ai jobs at a time per workspace, with room for another workspace', () => {
    // pg-boss's in-process group limit: exact in the one worker §13 runs. Its database-tracked limit
    // (groupConcurrency) takes no lock, so workers fetching at the same moment can start a fifth.
    expect(queues.ai.work).toEqual({ localGroupConcurrency: 4, localConcurrency: 8 });
  });
});

describe('sending a job', () => {
  // Never started, on a port nothing listens on: a refused payload must stop before pg-boss is reached.
  const jobs = createJobs({
    url: 'postgres://nobody:nothing@127.0.0.1:9/none',
    db: {} as Db,
    onError: () => undefined,
  });

  it('refuses a payload carrying content before it reaches the queue', async () => {
    await expect(
      jobs.send('email', { workspaceId, emailMessageId, body: 'Hello Nadia' } as never),
    ).rejects.toThrow(JobPayloadError);
  });

  it('refuses a payload whose ids are not ids', async () => {
    await expect(
      jobs.send('render', { workspaceId, postId: 'post 1', postVersionId: 'v2' }),
    ).rejects.toThrow(JobPayloadError);
  });
});
