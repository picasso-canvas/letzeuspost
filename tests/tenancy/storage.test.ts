// Storage (§13 File storage, Keeping workspaces apart): A's context can't sign a link, to read or to upload, to any of
// B's keys, nor to a key that only starts like one of A's; and a link A was given doesn't open B's file. The keys are
// built for workspaces A and B as the fixtures make them, and B's file is really in the store (SeaweedFS here).
import { randomUUIDv7 } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import type { WorkspaceCtx } from '../../packages/db/src/index.ts';
import {
  assetKey,
  checkKey,
  createStorage,
  exportKey,
  renderKey,
  StorageKeyError,
  type Storage,
} from '../../packages/storage/src/index.ts';
import { setUpTenancy, type Tenancy } from './fixtures.ts';

const env = loadEnv('web');
let t: Tenancy;
let storage: Storage;

beforeAll(async () => {
  t = await setUpTenancy('storage');
  storage = createStorage(env);
}, 60_000);

afterAll(async () => {
  storage.close();
  await t.close();
});

const limits = { maxBytes: 1024, contentTypes: ['text/plain'] };

/** One key of every kind §13 names, in `ctx`'s workspace. */
function keysOf(ctx: WorkspaceCtx) {
  const brandId = randomUUIDv7();
  const assetId = randomUUIDv7();
  return [
    assetKey(ctx, { brandId, assetId, variant: 'original' }),
    assetKey(ctx, { brandId, assetId, variant: '1600' }),
    assetKey(ctx, { brandId, assetId, variant: '360' }),
    renderKey(ctx, { hash: 'ab'.repeat(16), format: 'png' }),
    exportKey(ctx, { exportId: randomUUIDv7(), name: 'posts.zip' }),
  ];
}

/** B's key written so it starts with A's prefix: `ws/<A>/../<B>/…`. */
const climbingOutOfA = (keyB: string) =>
  keyB.replace(
    `ws/${t.b.ctx.workspaceId}/`,
    `ws/${t.a.ctx.workspaceId}/../${t.b.ctx.workspaceId}/`,
  );

describe('storage links', () => {
  it('signs no link, to read or to upload, to any of B’s keys from A’s context', async () => {
    const upload = { contentType: 'text/plain', size: 5 };
    for (const keyB of keysOf(t.b.ctx)) {
      expect(() => checkKey(t.a.ctx, keyB)).toThrow(StorageKeyError);
      await expect(storage.signDownload(t.a.ctx, keyB)).rejects.toThrow(StorageKeyError);
      await expect(storage.signDownload(t.a.ctx, keyB, { export: true })).rejects.toThrow(
        StorageKeyError,
      );
      await expect(storage.signUpload(t.a.ctx, keyB, upload, limits)).rejects.toThrow(
        StorageKeyError,
      );

      const climbing = climbingOutOfA(keyB);
      expect(climbing.startsWith(`ws/${t.a.ctx.workspaceId}/`)).toBe(true);
      expect(() => checkKey(t.a.ctx, climbing)).toThrow(StorageKeyError);
      await expect(storage.signDownload(t.a.ctx, climbing)).rejects.toThrow(StorageKeyError);
      await expect(storage.signUpload(t.a.ctx, climbing, upload, limits)).rejects.toThrow(
        StorageKeyError,
      );
    }
  });

  it('signs A’s own keys, each link inside A’s folder (so the refusals above are about B’s)', async () => {
    for (const keyA of keysOf(t.a.ctx)) {
      expect(checkKey(t.a.ctx, keyA)).toBe(keyA);
      const { url } = await storage.signDownload(t.a.ctx, keyA);
      expect(new URL(url).pathname).toBe(`/${env.STORAGE_BUCKET}/${keyA}`);
    }
  });

  it('a link signed for A’s file doesn’t open B’s file at the same place in B’s folder', async () => {
    // B's file, uploaded through B's own signed link.
    const [keyB = ''] = keysOf(t.b.ctx);
    const body = Buffer.from(`tenancy ${t.run} B`);
    const upload = { contentType: 'text/plain', size: body.length };
    const signedB = await storage.signUpload(t.b.ctx, keyB, upload, limits);
    const put = await fetch(signedB.url, { method: 'PUT', headers: signedB.headers, body });
    expect(put.ok).toBe(true);
    // B can read it: the file is there.
    expect((await fetch((await storage.signDownload(t.b.ctx, keyB)).url)).status).toBe(200);

    // A's link to the same place in A's folder, with the path turned to B's: refused by the store.
    const keyA = keyB.replace(t.b.ctx.workspaceId, t.a.ctx.workspaceId);
    const swapped = new URL((await storage.signDownload(t.a.ctx, keyA)).url);
    swapped.pathname = swapped.pathname.replace(t.a.ctx.workspaceId, t.b.ctx.workspaceId);
    expect(swapped.pathname).toBe(`/${env.STORAGE_BUCKET}/${keyB}`);
    const read = await fetch(swapped);
    expect(read.status).toBe(403);
    expect(await read.text()).not.toContain(`tenancy ${t.run} B`);
  });
});
