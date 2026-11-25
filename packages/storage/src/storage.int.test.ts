// The signed links and the worker's reads and writes against a real S3 server (SeaweedFS in development and CI): what
// the server accepts and refuses is the proof that the size, the type, the lifetime, the private bucket and the
// workspace prefix hold. Runs in `pnpm check:services` and CI's
// `services` job. Every key sits under a workspace id made for this run and is deleted afterwards.
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadEnv } from '@lzp/config';
import { afterAll, describe, expect, it } from 'vitest';
import { processImage, saveImageSet } from './images.ts';
import { assetKey, exportKey, StorageKeyError } from './keys.ts';
import { createStorage, type UploadLimits } from './storage.ts';

const env = loadEnv('web');
const settings = {
  STORAGE_ENDPOINT: env.STORAGE_ENDPOINT,
  STORAGE_REGION: env.STORAGE_REGION,
  STORAGE_BUCKET: env.STORAGE_BUCKET,
  STORAGE_ACCESS_KEY_ID: env.STORAGE_ACCESS_KEY_ID,
  STORAGE_SECRET_ACCESS_KEY: env.STORAGE_SECRET_ACCESS_KEY,
};

/** A UUIDv7-shaped id (version nibble 7), new to this run. */
function newId(): string {
  return randomUUID().replace(/^(.{14})4/, '$17');
}

const workspaceId = newId();
const ctx = { workspaceId };
const storage = createStorage(settings);
const limits: UploadLimits = { maxBytes: 1024, contentTypes: ['image/png'] };

const cleanup = new S3Client({
  endpoint: settings.STORAGE_ENDPOINT,
  region: settings.STORAGE_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: settings.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: settings.STORAGE_SECRET_ACCESS_KEY,
  },
});
const made: string[] = [];

/** An asset original key that is new to this run, remembered for the cleanup: the only key a browser may upload to. */
function newKey(): string {
  const key = assetKey(ctx, { brandId: newId(), assetId: newId(), variant: 'original' });
  made.push(key);
  return key;
}

/** An export file key, new to this run. The worker writes these, so the test writes it directly, not through a link. */
async function seedExport(body: string): Promise<string> {
  const key = exportKey(ctx, { exportId: newId(), name: 'post.zip' });
  made.push(key);
  await cleanup.send(
    new PutObjectCommand({ Bucket: settings.STORAGE_BUCKET, Key: key, Body: body }),
  );
  return key;
}

/**
 * Sends `body` with exactly the headers given, like a browser would: Node's `fetch` refuses a content-length that
 * differs from its body, which is one of the cases to try, so this talks HTTP itself.
 */
function send(
  method: 'PUT' | 'GET',
  url: string,
  headers: Record<string, string> = {},
  body?: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

afterAll(async () => {
  await Promise.all(
    made.map((key) =>
      cleanup.send(new DeleteObjectCommand({ Bucket: settings.STORAGE_BUCKET, Key: key })),
    ),
  );
  cleanup.destroy();
});

describe('a signed upload link', () => {
  it('accepts a file of the signed size and type', async () => {
    const key = newKey();
    const file = randomBytes(512);
    const link = await storage.signUpload(
      ctx,
      key,
      { contentType: 'image/png', size: 512 },
      limits,
    );
    const response = await send('PUT', link.url, link.headers, file);
    expect(response.status).toBe(200);
    const read = await storage.signDownload(ctx, key);
    expect((await send('GET', read.url)).status).toBe(200);
  });

  it('accepts a file at the size limit', async () => {
    const key = newKey();
    const link = await storage.signUpload(
      ctx,
      key,
      { contentType: 'image/png', size: limits.maxBytes },
      limits,
    );
    const response = await send('PUT', link.url, link.headers, randomBytes(limits.maxBytes));
    expect(response.status).toBe(200);
  });

  it('refuses a larger file than the one signed for', async () => {
    const key = newKey();
    const link = await storage.signUpload(
      ctx,
      key,
      { contentType: 'image/png', size: 512 },
      limits,
    );
    const bigger = randomBytes(limits.maxBytes * 4);
    const headers = { ...link.headers, 'content-length': String(bigger.length) };
    const response = await send('PUT', link.url, headers, bigger);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const read = await storage.signDownload(ctx, key);
    expect((await send('GET', read.url)).status).toBeGreaterThanOrEqual(400); // nothing was stored
  });

  it('refuses another type than the one signed for', async () => {
    const key = newKey();
    const link = await storage.signUpload(
      ctx,
      key,
      { contentType: 'image/png', size: 512 },
      limits,
    );
    const headers = { ...link.headers, 'content-type': 'text/html' };
    const response = await send('PUT', link.url, headers, randomBytes(512));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const read = await storage.signDownload(ctx, key);
    expect((await send('GET', read.url)).status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to be used for another key', async () => {
    const link = await storage.signUpload(
      ctx,
      newKey(),
      { contentType: 'image/png', size: 512 },
      limits,
    );
    const elsewhere = new URL(link.url);
    elsewhere.pathname = `/${settings.STORAGE_BUCKET}/${newKey()}`;
    const response = await send('PUT', elsewhere.href, link.headers, randomBytes(512));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('a signed download link', () => {
  it('reads the file', async () => {
    const key = newKey();
    const file = randomBytes(64).toString('hex');
    const up = await storage.signUpload(ctx, key, { contentType: 'image/png', size: 128 }, limits);
    await send('PUT', up.url, up.headers, Buffer.from(file));
    const read = await storage.signDownload(ctx, key);
    const response = await send('GET', read.url);
    expect(response.status).toBe(200);
    expect(response.body).toBe(file);
  });

  it('is refused once it has expired', async () => {
    const key = newKey();
    const up = await storage.signUpload(ctx, key, { contentType: 'image/png', size: 4 }, limits);
    await send('PUT', up.url, up.headers, Buffer.from('data'));
    const longAgo = createStorage(settings, { now: () => new Date(Date.now() - 20 * 60 * 1000) });
    const expired = await longAgo.signDownload(ctx, key); // 15 minutes from 20 minutes ago
    expect((await send('GET', expired.url)).status).toBeGreaterThanOrEqual(400);
    const fresh = await storage.signDownload(ctx, key);
    expect((await send('GET', fresh.url)).status).toBe(200);
  });

  it('is refused once an export link has lasted 7 days', async () => {
    const key = await seedExport('data');
    const week = 7 * 24 * 60 * 60 * 1000;
    const old = createStorage(settings, { now: () => new Date(Date.now() - week - 60 * 1000) });
    const expired = await old.signDownload(ctx, key, { export: true });
    expect((await send('GET', expired.url)).status).toBeGreaterThanOrEqual(400);
    const alive = createStorage(settings, { now: () => new Date(Date.now() - week + 3600 * 1000) });
    expect(
      (await send('GET', (await alive.signDownload(ctx, key, { export: true })).url)).status,
    ).toBe(200);
  });
});

describe("the worker's get, put, head and delete", () => {
  /** A resized copy's key, new to this run: a key only the worker writes. */
  function workerKey(): string {
    const key = assetKey(ctx, { brandId: newId(), assetId: newId(), variant: '1600' });
    made.push(key);
    return key;
  }

  it('write a file, tell its size and type, read it back and delete it', async () => {
    const key = workerKey();
    const file = new Uint8Array(randomBytes(300));
    await storage.put(ctx, key, file, 'image/jpeg');
    expect(await storage.head(ctx, key)).toEqual({ size: 300, contentType: 'image/jpeg' });
    expect(Buffer.from((await storage.get(ctx, key, { maxBytes: 300 })) ?? [])).toEqual(
      Buffer.from(file),
    );
    await storage.delete(ctx, key);
    expect(await storage.head(ctx, key)).toBeNull();
    expect(await storage.get(ctx, key, { maxBytes: 300 })).toBeNull();
  });

  it('replace a file written before', async () => {
    const key = workerKey();
    await storage.put(ctx, key, new Uint8Array([1, 2, 3]), 'image/png');
    await storage.put(ctx, key, new Uint8Array([4, 5]), 'image/jpeg');
    expect(await storage.get(ctx, key, { maxBytes: 10 })).toEqual(new Uint8Array([4, 5]));
    expect(await storage.head(ctx, key)).toEqual({ size: 2, contentType: 'image/jpeg' });
  });

  it("find nothing for a file that isn't there, and delete it without an error", async () => {
    const key = workerKey();
    expect(await storage.head(ctx, key)).toBeNull();
    expect(await storage.get(ctx, key, { maxBytes: 10 })).toBeNull();
    await expect(storage.delete(ctx, key)).resolves.toBeUndefined();
  });

  it('read a file at the byte cap and refuse one byte over it', async () => {
    const key = newKey(); // an upload's original: the worker reads what the browser sent
    const up = await storage.signUpload(ctx, key, { contentType: 'image/png', size: 64 }, limits);
    await send('PUT', up.url, up.headers, randomBytes(64));
    expect((await storage.get(ctx, key, { maxBytes: 64 }))?.length).toBe(64);
    await expect(storage.get(ctx, key, { maxBytes: 63 })).rejects.toThrow(/too large/i);
  });

  it("never reach another workspace's file, which stays as it was", async () => {
    const theirs = { workspaceId: newId() };
    const key = assetKey(theirs, { brandId: newId(), assetId: newId(), variant: '360' });
    made.push(key);
    await cleanup.send(
      new PutObjectCommand({ Bucket: settings.STORAGE_BUCKET, Key: key, Body: 'theirs' }),
    );
    await expect(storage.get(ctx, key, { maxBytes: 100 })).rejects.toThrow(StorageKeyError);
    await expect(storage.head(ctx, key)).rejects.toThrow(StorageKeyError);
    await expect(storage.put(ctx, key, new Uint8Array([1]), 'image/jpeg')).rejects.toThrow(
      StorageKeyError,
    );
    await expect(storage.delete(ctx, key)).rejects.toThrow(StorageKeyError);
    expect(await storage.get(theirs, key, { maxBytes: 100 })).toEqual(
      new Uint8Array(Buffer.from('theirs')),
    );
  });
});

describe('an uploaded image', () => {
  it('is read, processed and written back as its three sizes, under assetKey, never as SVG', async () => {
    const asset = { brandId: newId(), assetId: newId() };
    const keys = (['original', '1600', '360'] as const).map((variant) =>
      assetKey(ctx, { ...asset, variant }),
    );
    made.push(...keys);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><script>alert(1)</script><rect width="2000" height="1000" fill="#ff0000"/></svg>',
    );
    const svgLimits: UploadLimits = { maxBytes: 1024, contentTypes: ['image/svg+xml'] };
    const up = await storage.signUpload(
      ctx,
      keys[0] ?? '',
      { contentType: 'image/svg+xml', size: svg.length },
      svgLimits,
    );
    expect((await send('PUT', up.url, up.headers, svg)).status).toBe(200);

    const upload = await storage.get(ctx, keys[0] ?? '', { maxBytes: svgLimits.maxBytes });
    const set = await processImage(upload ?? new Uint8Array());
    await saveImageSet(storage, ctx, asset, set);

    const stored = await Promise.all(keys.map((key) => storage.head(ctx, key)));
    expect(stored).toEqual([
      { size: set.files.original.data.byteLength, contentType: 'image/png' },
      { size: set.files['1600'].data.byteLength, contentType: 'image/webp' },
      { size: set.files['360'].data.byteLength, contentType: 'image/webp' },
    ]);
  });
});

describe('the bucket', () => {
  it('is private: a read with no signature is refused', async () => {
    const key = newKey();
    const up = await storage.signUpload(ctx, key, { contentType: 'image/png', size: 4 }, limits);
    await send('PUT', up.url, up.headers, Buffer.from('data'));
    const plain = `${settings.STORAGE_ENDPOINT}/${settings.STORAGE_BUCKET}/${key}`;
    expect((await send('GET', plain)).status).toBe(403);
    expect(
      (await send('GET', `${settings.STORAGE_ENDPOINT}/${settings.STORAGE_BUCKET}/`)).status,
    ).toBe(403);
  });

  it('refuses a write with no signature', async () => {
    const key = newKey();
    const plain = `${settings.STORAGE_ENDPOINT}/${settings.STORAGE_BUCKET}/${key}`;
    const response = await send('PUT', plain, { 'content-length': '4' }, Buffer.from('data'));
    expect(response.status).toBe(403);
  });
});
