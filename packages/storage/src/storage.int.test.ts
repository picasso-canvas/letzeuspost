// The signed links against a real S3 server (SeaweedFS in development and CI): what the server accepts and refuses is
// the proof that the size, the type, the lifetime and the private bucket hold. Runs in `pnpm check:services` and CI's
// `services` job. Every key sits under a workspace id made for this run and is deleted afterwards.
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadEnv } from '@lzp/config';
import { afterAll, describe, expect, it } from 'vitest';
import { assetKey, exportKey } from './keys.ts';
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
