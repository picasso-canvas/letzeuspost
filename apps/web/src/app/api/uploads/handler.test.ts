// The upload route's handler (#403, §13 The app's API: `/api/uploads`, signed upload links; §06 Reading uploaded files;
// §02 Running out, and limits; §15's matrix, `edit-brands`), with the database, the guard, the limiter and the signer
// as fakes and the real upload rules of @lzp/core. tests/tenancy/uploads.test.ts runs it on the real ones.
import type { Guarded } from '@lzp/auth';
import type { StartedUploads, UploadRound, WorkspaceCtx } from '@lzp/db';
import { describe, expect, it } from 'vitest';
import { checkUploadRound } from '../../../../../../packages/core/src/quotas/uploads.ts';
import { createUploadsHandler, UPLOAD_ROUNDS_PER_WINDOW, type UploadsDeps } from './handler.ts';

const APP = 'https://app.letzeuspost.test';
const WS = '01900000-0000-7000-8000-000000000001';
const USER = '01900000-0000-7000-8000-000000000002';
const BRAND = '01900000-0000-7000-8000-000000000003';
const ASSET = '01900000-0000-7000-8000-000000000004';
const KEY = `ws/${WS}/brands/${BRAND}/assets/${ASSET}/original`;

const member = (role: 'owner' | 'editor' | 'viewer') => ({
  id: WS,
  name: 'Agency',
  slug: 'agency',
  role,
});

function allowed(role: 'owner' | 'editor' = 'editor'): Guarded {
  return {
    ok: true,
    person: { userId: USER, name: 'Mitu', email: 'mitu@agency.test' },
    session: { token: 'opaque', userId: USER },
    workspace: member(role),
    workspaces: [member(role)],
  };
}

/** A handler on fakes that record every step reached, in order. */
function harness(change: Partial<UploadsDeps> = {}) {
  const steps: string[] = [];
  const rounds: { ctx: WorkspaceCtx; round: UploadRound }[] = [];
  const signed: { key: string; file: { contentType: string; size: number } }[] = [];
  const deps: UploadsDeps = {
    appOrigin: APP,
    guard: (headers, action) => {
      steps.push(`guard:${action}:${headers.get('cookie') ?? ''}`);
      return Promise.resolve(allowed());
    },
    rateLimit: (ctx, userId) => {
      steps.push(`rate:${ctx.workspaceId}:${userId}`);
      return Promise.resolve(true);
    },
    checkRound: (files) => {
      steps.push('round');
      return checkUploadRound(files);
    },
    start: (ctx, round): Promise<StartedUploads> => {
      steps.push('start');
      rounds.push({ ctx, round });
      return Promise.resolve({
        started: round.files.map((_, at) => ({
          assetId: at === 0 ? ASSET : `${ASSET.slice(0, -1)}${String(at)}`,
          storageKey: at === 0 ? KEY : `${KEY}-${String(at)}`,
        })),
      });
    },
    sign: (_ctx, key, file) => {
      steps.push('sign');
      signed.push({ key, file });
      return Promise.resolve({
        method: 'PUT',
        url: `https://files.test/${key}?signature=x`,
        headers: { 'content-type': file.contentType, 'content-length': String(file.size) },
      });
    },
    ...change,
  };
  return { handler: createUploadsHandler(deps), steps, rounds, signed };
}

const photo = { kind: 'photo', contentType: 'image/png', size: 1000 };

function post(body: unknown, headers: Record<string, string> = {}, raw?: string): Request {
  return new Request(`${APP}/api/uploads`, {
    method: 'POST',
    headers: {
      cookie: 'session=opaque',
      'content-type': 'application/json',
      origin: APP,
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
}

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

describe('POST /api/uploads', () => {
  it('signs a round: a waiting asset per file, started for the member in the session’s workspace', async () => {
    const { handler, steps, rounds, signed } = harness();
    const response = await handler(post({ brandId: BRAND, files: [photo] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      uploads: [
        {
          assetId: ASSET,
          upload: {
            method: 'PUT',
            url: `https://files.test/${KEY}?signature=x`,
            headers: { 'content-type': 'image/png', 'content-length': '1000' },
          },
        },
      ],
    });
    expect(steps).toEqual([
      'guard:edit-brands:session=opaque',
      `rate:${WS}:${USER}`,
      'round',
      'start',
      'sign',
    ]);
    expect(rounds).toEqual([
      {
        ctx: { workspaceId: WS },
        round: { brandId: BRAND, uploadedBy: USER, files: [{ kind: 'photo', sizeBytes: 1000 }] },
      },
    ]);
    expect(signed).toEqual([{ key: KEY, file: { contentType: 'image/png', size: 1000 } }]);
  });

  it('runs the guard first, for `edit-brands`, and stops at its refusal', async () => {
    for (const [refused, status] of [
      ['no-session', 401],
      ['no-workspace', 403],
      ['not-a-member', 403],
      ['not-allowed', 403],
    ] as const) {
      const { handler, steps } = harness({
        guard: () => {
          return Promise.resolve({ ok: false, refused });
        },
      });
      // Even a request that would fail every later check is answered by the guard.
      const response = await handler(post(null, { origin: 'https://evil.test' }, 'not json'));
      expect(response.status, refused).toBe(status);
      expect(steps, refused).toEqual([]);
    }
  });

  it('refuses a request from another site, or with no origin (CSRF: the session cookie is not enough)', async () => {
    for (const origin of [
      'https://evil.test',
      'null',
      `${APP}.evil.test`,
      'http://app.letzeuspost.test',
    ]) {
      const { handler, steps } = harness();
      const response = await handler(post({ brandId: BRAND, files: [photo] }, { origin }));
      expect(response.status, origin).toBe(403);
      expect(steps, origin).toEqual(['guard:edit-brands:session=opaque']);
    }
    const { handler } = harness();
    const request = post({ brandId: BRAND, files: [photo] });
    request.headers.delete('origin');
    expect((await handler(request)).status).toBe(403);
  });

  it('takes only a JSON body of the round’s shape', async () => {
    for (const [what, request] of [
      ['a form', post(null, { 'content-type': 'application/x-www-form-urlencoded' }, 'a=1')],
      ['not JSON', post(null, {}, '{')],
      ['no brand', post({ files: [photo] })],
      ['a brand that is no id', post({ brandId: 'brand-1', files: [photo] })],
      ['an unknown kind', post({ brandId: BRAND, files: [{ ...photo, kind: 'meme' }] })],
      ['a size that is text', post({ brandId: BRAND, files: [{ ...photo, size: '1000' }] })],
      ['a field it doesn’t know', post({ brandId: BRAND, files: [photo], workspaceId: WS })],
      ['an uploader of its own', post({ brandId: BRAND, files: [{ ...photo, uploadedBy: USER }] })],
    ] as const) {
      const { handler, steps } = harness();
      const response = await handler(request);
      expect(response.status, what).toBe(400);
      expect(steps.includes('start'), what).toBe(false);
    }
  });

  it('refuses a body larger than a round could be, without reading it all', async () => {
    const { handler, steps } = harness();
    const response = await handler(
      post(null, {}, `{"brandId":"${BRAND}","files":[${'"x",'.repeat(40_000)}"x"]}`),
    );
    expect(response.status).toBe(413);
    expect(steps).toEqual(['guard:edit-brands:session=opaque']);
  });

  it('signs only PNG, JPG, WebP, SVG and PDF, up to 20 MB each and 30 files a round', async () => {
    const MB = 1024 * 1024;
    for (const [what, files, message] of [
      [
        'a GIF',
        [{ ...photo, contentType: 'image/gif' }],
        'Only PNG, JPG, WebP, SVG and PDF files can be uploaded.',
      ],
      [
        'an HTML page',
        [{ ...photo, contentType: 'text/html' }],
        'Only PNG, JPG, WebP, SVG and PDF files can be uploaded.',
      ],
      ['21 MB', [{ ...photo, size: 20 * MB + 1 }], 'Each file can be at most 20 MB.'],
      [
        '31 files',
        Array.from({ length: 31 }, () => photo),
        'At most 30 files can be uploaded at a time.',
      ],
      ['no files', [], 'Choose at least one file to upload.'],
    ] as const) {
      const { handler, steps } = harness();
      const response = await handler(post({ brandId: BRAND, files }));
      expect(response.status, what).toBe(400);
      expect(await errorOf(response), what).toBe(message);
      expect(steps.includes('start'), what).toBe(false);
    }
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
    ]) {
      const { handler } = harness();
      const files = Array.from({ length: 30 }, () => ({ ...photo, contentType, size: 20 * MB }));
      expect((await handler(post({ brandId: BRAND, files }))).status, contentType).toBe(200);
    }
  });

  it('refuses past the rate limit, before anything is added', async () => {
    const { handler, steps } = harness({ rateLimit: () => Promise.resolve(false) });
    const response = await handler(post({ brandId: BRAND, files: [photo] }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(steps).toEqual(['guard:edit-brands:session=opaque']);
    expect(UPLOAD_ROUNDS_PER_WINDOW).toBeGreaterThan(0);
  });

  it('answers 404 for a brand the workspace doesn’t have, and signs nothing', async () => {
    const { handler, steps } = harness({ start: () => Promise.resolve({ refused: 'no-brand' }) });
    const response = await handler(post({ brandId: BRAND, files: [photo] }));
    expect(response.status).toBe(404);
    expect(steps.includes('sign')).toBe(false);
  });

  it('refuses a round past the plan’s storage with the next-plan message, and signs nothing', async () => {
    const message =
      'These files would go past the 10 GB of storage in your Starter plan. The Agency plan has 50 GB.';
    const { handler, steps } = harness({
      start: () => Promise.resolve({ refused: 'storage', message }),
    });
    const response = await handler(post({ brandId: BRAND, files: [photo] }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe(message);
    expect(steps.includes('sign')).toBe(false);
  });

  it('answers 500 with no detail when a step fails', async () => {
    const secret = 'postgres://lzp_app:hunter2@db.internal/letzeuspost';
    const { handler } = harness({ start: () => Promise.reject(new Error(secret)) });
    const response = await handler(post({ brandId: BRAND, files: [photo] }));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('db.internal');
  });
});
