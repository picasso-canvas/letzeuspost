// The upload route's real dependencies (#403): the storage limit from config/plans.ts, and the limits each signed link
// carries. The guard, the rate limiter and the rows run on the real services in tests/tenancy/uploads.test.ts.
import { GB, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from '@lzp/core';
import type { Db } from '@lzp/db';
import type { Storage, UploadLimits, UploadRequest } from '@lzp/storage';
import { describe, expect, it } from 'vitest';
import { storageQuota, uploadsDeps } from './deps.ts';

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
    const asked: { ctx: unknown; key: string; upload: UploadRequest; limits: UploadLimits }[] = [];
    const storage: Pick<Storage, 'signUpload'> = {
      signUpload: (ctx, key, upload, limits) => {
        asked.push({ ctx, key, upload, limits });
        return Promise.resolve({
          method: 'PUT',
          url: `https://files.test/${key}`,
          headers: { 'content-type': upload.contentType, 'content-length': String(upload.size) },
          expiresAt: new Date(0),
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
