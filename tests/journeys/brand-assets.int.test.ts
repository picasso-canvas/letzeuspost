// The Asset library feature's journey (§19 Features; §06 Asset library, §10, §13 File storage): a member uploads a
// file, it goes straight to the bucket through a signed link, the worker's `asset` job checks and processes it, and it
// becomes a ready asset of the member's brand that another workspace can't see. It was written with the feature's
// first task (#400), before the route and the processing, and marked as an expected failure until #403 added
// apps/web's `/api/uploads` route.ts (§13 Routes: signed upload links).
//
// Whether the photo is usable in a post isn't checked here: that needs its people check (`peoplePresent`), which only
// the tagging (`tagAsset`, #405) sets (Zeus, 2026-11-27, on #403). The calls follow the route's real API (handler.ts:
// a round of files, a link per file); a later task may change a call again to follow it, but never weaken an assertion.
//
// Runs only in `pnpm check:services` and CI's `services` job (the `.int.test.ts` name; Postgres and the file store
// come from docker/compose.yml). The workspaces, people and rows are this run's, from the tenancy suite's fixtures.
import { describe, expect, it } from 'vitest';
import { loadEnv, type Env } from '../../config/env.ts';
import { guard } from '../../packages/auth/src/index.ts';
import { asset } from '../../packages/db/src/index.ts';
import { assetKey, createStorage } from '../../packages/storage/src/index.ts';
import { encodePng } from '../golden/png.ts';
import { headersWith, setUpTenancy, text } from '../tenancy/fixtures.ts';

/** `startWorker` of apps/worker, loaded by URL as data.int.test.ts loads it (its types are the parts used here). */
type StartWorker = (
  env: Env<'worker'>,
  options: { pollingIntervalSeconds: number },
) => Promise<{ stop: () => Promise<void> }>;

/** The upload route's handler, as Next calls it. */
interface UploadsRoute {
  POST: (request: Request) => Promise<Response>;
}

/** What the route answers: per file of the round, the new asset's id and the signed link to put it to. */
interface UploadAnswer {
  uploads: {
    assetId: string;
    upload: { method: 'PUT'; url: string; headers: Record<string, string> };
  }[];
}

/** A round of one file of A's brand, as the browser asks for it with `cookie`'s session. */
function askToUpload(url: string, cookie: string, brandId: string, size: number): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      ...Object.fromEntries(headersWith(cookie)),
      'content-type': 'application/json',
      origin: new URL(url).origin,
    },
    body: JSON.stringify({ brandId, files: [{ kind: 'photo', contentType: 'image/png', size }] }),
  });
}

async function loadUploadsRoute(): Promise<UploadsRoute> {
  const url = new URL('../../apps/web/src/app/api/uploads/route.ts', import.meta.url).href;
  const route = (await import(url)) as Partial<UploadsRoute>;
  if (typeof route.POST !== 'function') {
    throw new Error('apps/web has no /api/uploads route');
  }
  return route as UploadsRoute;
}

/** A small photo: a 64 × 48 gradient, so the perceptual hash has something to read. */
function photo(): Uint8Array<ArrayBuffer> {
  const width = 64;
  const height = 48;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      rgba.set([x * 4, y * 5, 128, 255], at);
    }
  }
  // Copied into a buffer of its own, the body type `fetch` takes.
  return new Uint8Array(encodePng({ width, height, rgba }));
}

/** Waits for `check` to be true, up to `seconds`. */
async function until(check: () => Promise<boolean>, seconds: number): Promise<boolean> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return check();
}

describe('the Asset library feature: an uploaded file becomes a ready asset of its brand', () => {
  it(
    'uploads a photo through a signed link, processes it, and keeps it in its workspace',
    { timeout: 120_000 },
    async () => {
      const t = await setUpTenancy('assets-journey');
      const cleanups: (() => Promise<void> | void)[] = [() => t.close()];
      try {
        const web = loadEnv('web');
        const storage = createStorage(web);
        cleanups.push(() => {
          storage.close();
        });
        const uploadsUrl = `${web.APP_URL}/api/uploads`;
        // Signed in, then the app opens (as its first page does), which gives the session its workspace: A.
        const cookie = await t.signIn(t.a.owner);
        expect((await guard().open(headersWith(cookie))).ok).toBe(true);
        const file = photo();

        // 1. The member asks for an upload link for a photo of A's brand: a new asset, waiting, with its own key.
        const route = await loadUploadsRoute();
        const asked = await route.POST(
          askToUpload(uploadsUrl, cookie, t.a.brand.id, file.byteLength),
        );
        expect(asked.status).toBe(200);
        const { uploads } = (await asked.json()) as UploadAnswer;
        expect(uploads).toHaveLength(1);
        const [first] = uploads;
        if (first === undefined) throw new Error('no upload in the answer');
        const { assetId, upload } = first;
        const key = assetKey(t.a.ctx, { brandId: t.a.brand.id, assetId, variant: 'original' });

        // 2. The browser puts the file straight to the bucket, with the headers the link was signed for.
        const put = await fetch(upload.url, {
          method: upload.method,
          headers: upload.headers,
          body: file,
        });
        expect(put.ok).toBe(true);

        // 3. The worker's `asset` job checks, re-encodes and copies it (§13 File storage); the row becomes ready.
        const { startWorker } = (await import(
          new URL('../../apps/worker/src/worker.ts', import.meta.url).href
        )) as { startWorker: StartWorker };
        const worker = await startWorker(loadEnv('worker'), { pollingIntervalSeconds: 0.5 });
        cleanups.push(() => worker.stop());
        const inA = () => t.app.forWorkspace(t.a.ctx).transaction((tx) => tx.select().from(asset));
        const ready = await until(
          async () => (await inA()).some((row) => row.id === assetId && row.status === 'ready'),
          60,
        );
        expect(ready).toBe(true);

        const row = (await inA()).find((each) => each.id === assetId);
        expect(row).toMatchObject({
          workspaceId: t.a.ctx.workspaceId,
          brandId: t.a.brand.id,
          kind: 'photo',
          storageKey: key,
          source: 'own',
          status: 'ready',
          uploadedBy: t.a.owner.id,
        });
        expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(row?.perceptualHash).toMatch(/^[0-9a-f]{16,64}$/);
        expect(row?.sizeBytes).toBeGreaterThan(0);

        // The original and its two copies are in the bucket, under A's brand.
        for (const variant of ['original', '1600', '360'] as const) {
          const link = await storage.signDownload(
            t.a.ctx,
            assetKey(t.a.ctx, { brandId: t.a.brand.id, assetId, variant }),
          );
          expect((await fetch(link.url)).status, variant).toBe(200);
        }

        // 4. B sees none of it: not the row, and not through the route with B's member asking for A's brand.
        const inB = await t.app
          .forWorkspace(t.b.ctx)
          .transaction((tx) => tx.select({ id: asset.id }).from(asset));
        expect(inB).toEqual([{ id: t.b.asset.id }]);
        const cookieB = await t.signIn(t.b.owner);
        expect((await guard().open(headersWith(cookieB))).ok).toBe(true);
        const crossed = await route.POST(
          askToUpload(uploadsUrl, cookieB, t.a.brand.id, file.byteLength),
        );
        expect([403, 404]).toContain(crossed.status);
        expect(
          await t.asOwner(
            text`select id from asset where brand_id = ${t.a.brand.id} and workspace_id = ${t.b.ctx.workspaceId}`,
          ),
        ).toEqual([]);
      } finally {
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
    },
  );
});
