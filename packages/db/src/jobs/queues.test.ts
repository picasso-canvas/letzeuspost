import { randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db.ts';
import { createJobs } from './boss.ts';
import {
  checkPayload,
  JobPayloadError,
  queueNames,
  queues,
  shortestRetryWindowSeconds,
  workspaceQueueNames,
} from './queues.ts';

const workspaceId = randomUUIDv7();
const emailMessageId = randomUUIDv7();

describe('the queues (§13 Jobs)', () => {
  it("declares §13's five queues, the account emails' queue (#77) and the asset library's (#400)", () => {
    expect([...queueNames].sort()).toEqual([
      'account-email',
      'ai',
      'asset',
      'email',
      'export',
      'fetch',
      'render',
    ]);
  });

  describe('an uploaded asset’s processing (#400, §13 File storage)', () => {
    const ids = { workspaceId, brandId: randomUUIDv7(), assetId: randomUUIDv7() };

    it('takes the workspace, the brand and the asset, by id', () => {
      expect(checkPayload('asset', ids)).toEqual(ids);
    });

    it.each([
      ['a file name', { name: 'mango-lassi.jpg' }],
      ['the storage key', { key: `ws/${workspaceId}/brands/x/assets/y/original` }],
      ['a Bangla description', { description: 'আমের লাচ্ছি, কাচের গ্লাসে' }],
      ['the file itself', { bytes: 'iVBORw0KGgo=' }],
      ['a batch', { batchId: randomUUIDv7() }],
    ])('refuses a payload carrying %s', (_, extra) => {
      expect(() => checkPayload('asset', { ...ids, ...extra })).toThrow(JobPayloadError);
    });

    it.each([
      ['no brand', { workspaceId, assetId: ids.assetId }],
      ['no asset', { workspaceId, brandId: ids.brandId }],
      ['no workspace', { brandId: ids.brandId, assetId: ids.assetId }],
      ['text in an id', { ...ids, assetId: 'photo 1' }],
    ])('refuses a payload with %s', (_, payload) => {
      expect(() => checkPayload('asset', payload)).toThrow(JobPayloadError);
    });
  });

  describe('the ai queue: a batch’s work, or an asset’s (tagAsset, §09)', () => {
    const batch = { workspaceId, batchId: randomUUIDv7(), postId: randomUUIDv7() };
    const asset = { workspaceId, brandId: randomUUIDv7(), assetId: randomUUIDv7() };

    it('takes a batch’s work, with or without a post, as before', () => {
      expect(checkPayload('ai', batch)).toEqual(batch);
      expect(checkPayload('ai', { workspaceId, batchId: batch.batchId })).toEqual({
        workspaceId,
        batchId: batch.batchId,
      });
    });

    it('takes an asset’s work without a batch', () => {
      expect(checkPayload('ai', asset)).toEqual(asset);
    });

    it.each([
      ['a description to write tags from', { description: 'A cup of tea' }],
      ['Bangla tags', { tags: ['চা', 'সকাল'] }],
      ['an image', { image: 'data:image/png;base64,iVBORw0KGgo=' }],
    ])('refuses an asset’s work carrying %s', (_, extra) => {
      expect(() => checkPayload('ai', { ...asset, ...extra })).toThrow(JobPayloadError);
    });

    it.each([
      [
        'a batch and an asset at once',
        { ...batch, brandId: asset.brandId, assetId: asset.assetId },
      ],
      ['an asset without its brand', { workspaceId, assetId: asset.assetId }],
      ['a brand alone', { workspaceId, brandId: asset.brandId }],
      ['a post without its batch', { workspaceId, postId: batch.postId }],
      ['only the workspace', { workspaceId }],
    ])('refuses %s', (_, payload) => {
      expect(() => checkPayload('ai', payload)).toThrow(JobPayloadError);
    });

    it('names the fields at fault, never their values', () => {
      const refused = () =>
        checkPayload('ai', { ...asset, description: 'নাদিয়ার ছবি', to: 'nadia@example.com' });
      expect(refused).toThrow(/description/);
      expect(refused).toThrow(/^(?![\s\S]*(nadia|নাদিয়া))/);
    });
  });

  it('takes an account email by its id alone: it belongs to a person, not a workspace', () => {
    const accountEmailId = randomUUIDv7();
    expect(checkPayload('account-email', { accountEmailId })).toEqual({ accountEmailId });
    for (const payload of [
      { accountEmailId, workspaceId },
      { accountEmailId, to: 'nadia@example.com' },
      { accountEmailId, url: 'http://localhost:3000/api/auth/magic-link/verify?token=x' },
      { accountEmailId: 'not an id' },
      {},
    ]) {
      expect(() => checkPayload('account-email', payload)).toThrow(JobPayloadError);
    }
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

  it.each(workspaceQueueNames)(
    'makes every %s payload carry its workspace and ids only',
    (name) => {
      expect(() => checkPayload(name, { workspaceId, text: 'hello' })).toThrow(JobPayloadError);
      expect(() => checkPayload(name, {})).toThrow(JobPayloadError);
    },
  );

  it.each(queueNames)('bounds the retries of %s, with backoff', (name) => {
    const { retryLimit, retryDelay, retryBackoff, retryDelayMax } = queues[name].queue;
    expect(retryLimit).toBeGreaterThanOrEqual(1);
    expect(retryLimit).toBeLessThanOrEqual(10);
    expect(retryDelay).toBeGreaterThan(0);
    expect(retryBackoff).toBe(true);
    expect(retryDelayMax).toBeGreaterThanOrEqual(retryDelay);
  });

  it('waits 60 s, then 2 and 4 minutes or more, before an asset job’s three retries (Zeus, 2026-11-28, on #403)', () => {
    // The asset job rejects a file that never arrived on its last try; its upload link (@lzp/storage's
    // UPLOAD_LINK_SECONDS, 5 minutes) must be gone by then, or a file PUT after the rejection would stay uncounted.
    expect(queues.asset.queue).toEqual({
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 600,
      expireInSeconds: 15 * 60,
    });
    expect(shortestRetryWindowSeconds('asset')).toBe(60 + 120 + 240);
  });

  it('keeps the other queues’ retries as they were: 30 s, with backoff, 3 retries', () => {
    for (const name of queueNames.filter((each) => each !== 'asset')) {
      expect(queues[name].queue, name).toMatchObject({ retryLimit: 3, retryDelay: 30 });
    }
    expect(shortestRetryWindowSeconds('email')).toBe(30 + 60 + 120);
  });

  it('runs at most 4 ai jobs at a time per workspace, with room for another workspace', () => {
    // pg-boss's in-process group limit: exact in the one worker §13 runs. Its database-tracked limit
    // (groupConcurrency) takes no lock, so workers fetching at the same moment can start a fifth.
    expect(queues.ai.work).toEqual({ localGroupConcurrency: 4, localConcurrency: 8 });
  });

  it('runs one asset job at a time per workspace and two in all, so one workspace’s PDFs can’t hold up the rest', () => {
    // Each asset job may run the hostile-PDF reader (up to 15 s, its memory capped): a workspace uploading many PDFs
    // gets one reader, and the other runs another workspace's upload (Cerberus F1 on #402).
    expect(queues.asset.work).toEqual({ localGroupConcurrency: 1, localConcurrency: 2 });
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
