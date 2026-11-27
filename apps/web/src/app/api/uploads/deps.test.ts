// The upload route's real dependencies (#403): the storage limit from config/plans.ts, the limits each signed link
// carries, and the `asset` queue's sender. The guard, the rate limiter and the rows run on the real services in
// tests/tenancy/uploads.test.ts.
import { GB, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from '@lzp/core';
import type { Db, Jobs, Tx } from '@lzp/db';
import { describe, expect, it } from 'vitest';
import { assetJobSender, storageQuota, uploadsDeps, type UploadSigner } from './deps.ts';

type Asked = Parameters<UploadSigner['signUpload']>;

const WS = { workspaceId: '01900000-0000-7000-8000-000000000001' };

describe('storageQuota(use)', () => {
  it('holds a workspace with no plan yet to Starter’s 10 GB (Zeus, 2026-11-26, on #403)', () => {
    expect(storageQuota({ plan: null, usedBytes: 10 * GB - 1000, addingBytes: 1000 })).toEqual({
      ok: true,
    });
    expect(storageQuota({ plan: null, usedBytes: 10 * GB - 1000, addingBytes: 1001 })).toEqual({
      ok: false,
      message:
        'These files would go past the 10 GB of storage in your Starter plan. The Agency plan has 50 GB.',
    });
  });

  it('takes each plan’s storage from config/plans.ts and names the next plan', () => {
    expect(storageQuota({ plan: 'agency', usedBytes: 50 * GB, addingBytes: 1 })).toEqual({
      ok: false,
      message:
        'These files would go past the 50 GB of storage in your Agency plan. The Scale plan has 200 GB.',
    });
    expect(storageQuota({ plan: 'scale', usedBytes: 199 * GB, addingBytes: GB })).toEqual({
      ok: true,
    });
    expect(storageQuota({ plan: 'scale', usedBytes: 200 * GB, addingBytes: 1 })).toEqual({
      ok: false,
      message:
        'These files would go past the 200 GB of storage in your Scale plan. Delete some files, or contact us for more.',
    });
  });

  it('never guesses a limit for a plan it doesn’t know', () => {
    expect(() => storageQuota({ plan: 'enterprise', usedBytes: 0, addingBytes: 1 })).toThrow(
      'no such plan',
    );
  });
});

describe('uploadsDeps(…).sign', () => {
  it('signs each link for §06’s types and 20 MB, to the key and workspace it was given', async () => {
    const asked: { ctx: Asked[0]; key: string; upload: Asked[2]; limits: Asked[3] }[] = [];
    const storage: UploadSigner = {
      signUpload: (ctx, key, upload, limits) => {
        asked.push({ ctx, key, upload, limits });
        return Promise.resolve({
          method: 'PUT',
          url: `https://files.test/${key}`,
          headers: { 'content-type': upload.contentType, 'content-length': String(upload.size) },
        });
      },
    };
    const deps = uploadsDeps({
      appOrigin: 'https://app.letzeuspost.test',
      db: {} as Db,
      send: () => Promise.reject(new Error('not used')),
      storage,
    });
    const key = `ws/${WS.workspaceId}/brands/b/assets/a/original`;
    await deps.sign(WS, key, { contentType: 'image/webp', size: 1234 });
    expect(asked).toEqual([
      {
        ctx: WS,
        key,
        upload: { contentType: 'image/webp', size: 1234 },
        limits: { maxBytes: MAX_UPLOAD_BYTES, contentTypes: [...UPLOAD_TYPES] },
      },
    ]);
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('assetJobSender(jobs)', () => {
  const payload = { workspaceId: WS.workspaceId, brandId: WS.workspaceId, assetId: WS.workspaceId };
  const tx = {} as Tx;

  /** A queue that counts its starts, fails the first `failures` of them, and records what it was sent. */
  function fakeJobs(failures = 0) {
    const calls = { starts: 0, sent: [] as { queue: string; payload: unknown; tx: unknown }[] };
    const jobs: Pick<Jobs, 'start' | 'send'> = {
      start: () => {
        calls.starts += 1;
        return calls.starts <= failures
          ? Promise.reject(new Error('Postgres is down'))
          : Promise.resolve();
      },
      send: (queue, sent, options) => {
        calls.sent.push({ queue, payload: sent, tx: options?.tx });
        return Promise.resolve(`job-${String(calls.sent.length)}`);
      },
    };
    return { calls, jobs };
  }

  it('starts the queue on the first round only, then queues each job on `asset` in the rows’ transaction', async () => {
    const { calls, jobs } = fakeJobs();
    const send = assetJobSender(jobs);
    expect(calls.starts).toBe(0);
    expect(await send(payload, { tx })).toBe('job-1');
    expect(await send(payload, { tx })).toBe('job-2');
    expect(calls.starts).toBe(1);
    expect(calls.sent).toEqual([
      { queue: 'asset', payload, tx },
      { queue: 'asset', payload, tx },
    ]);
  });

  it('starts once for rounds that come together', async () => {
    const { calls, jobs } = fakeJobs();
    const send = assetJobSender(jobs);
    await Promise.all([send(payload, { tx }), send(payload, { tx })]);
    expect(calls.starts).toBe(1);
  });

  it('fails a round whose queue couldn’t start, sends nothing, and tries to start again on the next', async () => {
    const { calls, jobs } = fakeJobs(1);
    const send = assetJobSender(jobs);
    await expect(send(payload, { tx })).rejects.toThrow('Postgres is down');
    expect(calls.sent).toEqual([]);
    expect(await send(payload, { tx })).toBe('job-1');
    expect(calls.starts).toBe(2);
  });
});
