// Signing is offline arithmetic (SigV4 over the settings and the clock), so these tests read the links they get back:
// what they sign, who they are for, and for how long. That a real server accepts and refuses them is checked in
// storage.int.test.ts, against SeaweedFS.
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { assetKey, exportKey, renderKey, StorageKeyError } from './keys.ts';
import { createStorage, UploadLimitError, type Storage, type UploadLimits } from './storage.ts';

const WORKSPACE = '019a5c3e-7b1a-7c2d-8e3f-4a5b6c7d8e9f';
const OTHER_WORKSPACE = '019a5c3e-7b1a-7c2d-8e3f-4a5b6c7d8ea0';
const BRAND = '019a5c3e-7b1b-7000-8000-000000000001';
const ASSET = '019a5c3e-7b1b-7000-8000-000000000002';
const EXPORT = '019a5c3e-7b1b-7000-8000-000000000003';
const HASH = 'b'.repeat(64);
const ctx = { workspaceId: WORKSPACE };

const settings = {
  STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'letzeuspost-test',
  STORAGE_ACCESS_KEY_ID: 'test-access-key',
  STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
} as const;

const NOW = new Date('2026-11-10T09:30:00.000Z');
const storage = createStorage(settings, { now: () => NOW });
const limits: UploadLimits = {
  maxBytes: 20 * 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png'],
};

/** The lifetime a signed link carries, in seconds, and the moment it was signed. */
function lifetime(url: string): { expires: number; signedAt: string } {
  const params = new URL(url).searchParams;
  return {
    expires: Number(params.get('X-Amz-Expires')),
    signedAt: params.get('X-Amz-Date') ?? '',
  };
}

describe('download links', () => {
  const key = renderKey(ctx, { hash: HASH, format: 'png' });

  it('last 15 minutes', async () => {
    const link = await storage.signDownload(ctx, key);
    expect(lifetime(link.url).expires).toBe(15 * 60);
    expect(lifetime(link.url).signedAt).toBe('20261110T093000Z');
    expect(link.expiresAt).toEqual(new Date('2026-11-10T09:45:00.000Z'));
  });

  it('last 7 days for an export file', async () => {
    const link = await storage.signDownload(
      ctx,
      exportKey(ctx, { exportId: EXPORT, name: 'a.zip' }),
      {
        export: true,
      },
    );
    expect(lifetime(link.url).expires).toBe(7 * 24 * 60 * 60);
    expect(link.expiresAt).toEqual(new Date('2026-11-17T09:30:00.000Z'));
  });

  it('point at the private bucket and the key, and carry a signature', async () => {
    const link = new URL((await storage.signDownload(ctx, key)).url);
    expect(link.origin).toBe(settings.STORAGE_ENDPOINT);
    expect(link.pathname).toBe(`/${settings.STORAGE_BUCKET}/${key}`);
    expect(link.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never carry the secret key', async () => {
    const { url } = await storage.signDownload(ctx, key);
    expect(url).not.toContain(settings.STORAGE_SECRET_ACCESS_KEY);
  });

  it('are refused for any key that is not an export file when asked for 7 days', async () => {
    const notExports = [
      assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' }),
      renderKey(ctx, { hash: HASH, format: 'png' }),
      `ws/${WORKSPACE}/exports/x`,
    ];
    for (const each of notExports) {
      await expect(storage.signDownload(ctx, each, { export: true }), each).rejects.toThrow(
        StorageKeyError,
      );
    }
  });

  it('last 15 minutes for an export file when 7 days is not asked for', async () => {
    const link = await storage.signDownload(
      ctx,
      exportKey(ctx, { exportId: EXPORT, name: 'a.zip' }),
    );
    expect(lifetime(link.url).expires).toBe(15 * 60);
  });

  it("are refused for a key outside the context's workspace", async () => {
    const other = renderKey({ workspaceId: OTHER_WORKSPACE }, { hash: HASH, format: 'png' });
    await expect(storage.signDownload(ctx, other)).rejects.toThrow(StorageKeyError);
    await expect(storage.signDownload(ctx, `ws/${WORKSPACE}/../${other.slice(3)}`)).rejects.toThrow(
      StorageKeyError,
    );
  });
});

describe('upload links', () => {
  const key = assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' });
  const photo = { contentType: 'image/png', size: 1234 } as const;

  it('are PUT links for this key, good for 15 minutes', async () => {
    const link = await storage.signUpload(ctx, key, photo, limits);
    expect(link.method).toBe('PUT');
    expect(new URL(link.url).pathname).toBe(`/${settings.STORAGE_BUCKET}/${key}`);
    expect(lifetime(link.url).expires).toBe(15 * 60);
    expect(link.expiresAt).toEqual(new Date('2026-11-10T09:45:00.000Z'));
  });

  it('sign the type and the exact size, and say which headers the browser must send', async () => {
    const link = await storage.signUpload(ctx, key, photo, limits);
    const signed = new URL(link.url).searchParams.get('X-Amz-SignedHeaders')?.split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-type', 'content-length', 'host']));
    expect(link.headers).toEqual({ 'content-type': 'image/png', 'content-length': '1234' });
  });

  it('accept a file at the size limit and refuse one byte over', async () => {
    const atLimit = { contentType: 'image/png', size: limits.maxBytes };
    await expect(storage.signUpload(ctx, key, atLimit, limits)).resolves.toBeDefined();
    await expect(
      storage.signUpload(ctx, key, { ...atLimit, size: limits.maxBytes + 1 }, limits),
    ).rejects.toThrow(/too large/i);
  });

  it('refuse an empty or nonsensical size', async () => {
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(storage.signUpload(ctx, key, { ...photo, size }, limits)).rejects.toThrow(
        /size/i,
      );
    }
  });

  it('refuse a type that is not allowed, whatever its case or parameters', async () => {
    for (const contentType of [
      'application/pdf',
      'text/html',
      'image/svg+xml',
      'image/png; x=1',
      '',
    ]) {
      await expect(storage.signUpload(ctx, key, { ...photo, contentType }, limits)).rejects.toThrow(
        /type/i,
      );
    }
    await expect(
      storage.signUpload(ctx, key, { ...photo, contentType: 'image/jpeg' }, limits),
    ).resolves.toBeDefined();
  });

  it("are refused for a key outside the context's workspace", async () => {
    const other = assetKey(
      { workspaceId: OTHER_WORKSPACE },
      { brandId: BRAND, assetId: ASSET, variant: 'original' },
    );
    await expect(storage.signUpload(ctx, other, photo, limits)).rejects.toThrow(StorageKeyError);
  });

  it('are refused for a render or an export file, which only the worker writes', async () => {
    const finished = [
      renderKey(ctx, { hash: HASH, format: 'png' }),
      exportKey(ctx, { exportId: EXPORT, name: 'a.zip' }),
      assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: '1600' }),
      assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: '360' }),
    ];
    for (const each of finished) {
      await expect(storage.signUpload(ctx, each, photo, limits), each).rejects.toThrow(
        StorageKeyError,
      );
    }
  });

  it('are refused for a path inside the workspace that is none of the three key shapes', async () => {
    for (const each of [
      `ws/${WORKSPACE}/anything/x`,
      `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}/original/extra`,
      `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}/huge`,
    ]) {
      await expect(storage.signUpload(ctx, each, photo, limits), each).rejects.toThrow(
        StorageKeyError,
      );
    }
  });
});

type RequestHandler = NonNullable<Parameters<typeof createStorage>[1]>['requestHandler'];

/**
 * A store that answers every request itself with `file` (no network), stating its real size; `reads` counts how many
 * times its body was asked for bytes.
 */
function answering(file: Buffer): { storage: Storage; body: Readable; reads: () => number } {
  let reads = 0;
  const body = new Readable({
    read() {
      reads += 1;
      this.push(file);
      this.push(null);
    },
  });
  const requestHandler: RequestHandler = {
    handle: () =>
      Promise.resolve({
        response: {
          statusCode: 200,
          headers: { 'content-length': String(file.length), 'content-type': 'image/png' },
          body,
        },
      }),
  };
  return { storage: createStorage(settings, { requestHandler }), body, reads: () => reads };
}

// The worker's own reads and writes. The key is checked before any request is made, so these run offline: the endpoint
// above has no server, and a request that got through would fail with a network error, not a StorageKeyError. That the
// operations work on a real bucket is checked in storage.int.test.ts.
describe("the worker's get, put, head and delete", () => {
  const other = { workspaceId: OTHER_WORKSPACE };
  const refused = [
    assetKey(other, { brandId: BRAND, assetId: ASSET, variant: '1600' }),
    renderKey(other, { hash: HASH, format: 'png' }),
    exportKey(other, { exportId: EXPORT, name: 'a.zip' }),
    `ws/${WORKSPACE}/../${OTHER_WORKSPACE}/renders/${HASH}.png`,
    `ws/${WORKSPACE}/anything/x`,
    `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}/original/extra`,
    `ws/${WORKSPACE}/`,
    `ws/${WORKSPACE}`,
    '',
  ];
  const body = new Uint8Array([1, 2, 3]);

  it("refuse a key in another workspace, or one that isn't a key a builder makes", async () => {
    for (const key of refused) {
      const name = JSON.stringify(key);
      await expect(storage.get(ctx, key, { maxBytes: 10 }), name).rejects.toThrow(StorageKeyError);
      await expect(storage.put(ctx, key, body, 'image/jpeg'), name).rejects.toThrow(
        StorageKeyError,
      );
      await expect(storage.head(ctx, key), name).rejects.toThrow(StorageKeyError);
      await expect(storage.delete(ctx, key), name).rejects.toThrow(StorageKeyError);
    }
  });

  it('never write a file as SVG, whatever its case or parameters: an SVG is only ever rasterised', async () => {
    const key = assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' });
    for (const type of ['image/svg+xml', 'IMAGE/SVG+XML', 'image/svg+xml; charset=utf-8']) {
      await expect(storage.put(ctx, key, body, type), type).rejects.toThrow(UploadLimitError);
    }
  });

  it('read a whole file within the cap', async () => {
    const { storage: answered } = answering(Buffer.alloc(1000, 7));
    const key = assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' });
    expect(await answered.get(ctx, key, { maxBytes: 1000 })).toEqual(new Uint8Array(1000).fill(7));
  });

  it('refuse a file the store says is over the cap without reading any of it', async () => {
    const { storage: answered, body, reads } = answering(Buffer.alloc(1000, 7));
    const key = assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' });
    await expect(answered.get(ctx, key, { maxBytes: 999 })).rejects.toThrow(UploadLimitError);
    expect(reads()).toBe(0);
    expect(body.destroyed).toBe(true);
  });

  it('refuse a read with a byte cap that is not a whole number above 0', async () => {
    const key = assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' });
    for (const maxBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(storage.get(ctx, key, { maxBytes }), String(maxBytes)).rejects.toThrow(
        RangeError,
      );
    }
  });
});
