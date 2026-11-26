// The upload route's handler on the real services (#403, §13 Keeping workspaces apart, The app's API, File storage;
// §15's matrix, `edit-brands`): the real guard and sessions, the app role's database with its row-level security, the
// app role's rate limiter, @lzp/core's upload rules and storage limit with config/plans.ts, and the real signer. The
// guard runs first: no session, a Viewer, and another workspace's member are refused, and nothing is added; a brand of
// another workspace is never found; a round past the plan's storage is refused with the next-plan message.
//
// The handler is wired here as apps/web's route.ts will wire it, with one difference: the `asset` job is recorded, not
// queued, so no worker of another services file picks up a file that never arrives (packages/db's uploads.int.test.ts
// checks that the jobs go in the rows' own transaction; the feature's journey runs the real queue). It is loaded by
// URL, as routes.test.ts loads apps/web's modules: the root's typecheck reads no apps/web dependency.
import { randomUUIDv7 } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { plans } from '../../config/plans.ts';
import { guard } from '../../packages/auth/src/index.ts';
import {
  checkStorage,
  checkUploadRound,
  GB,
  MAX_UPLOAD_BYTES,
  storagePlans,
  UPLOAD_TYPES,
} from '../../packages/core/src/quotas/uploads.ts';
import {
  hitWorkspaceRateLimit,
  member,
  startUploads,
  type Payload,
  type StartedUploads,
  type UploadRound,
  type WorkspaceCtx,
} from '../../packages/db/src/index.ts';
import { assetKey, createStorage, type Storage } from '../../packages/storage/src/index.ts';
import { headersWith, setUpTenancy, text, type Person, type Tenancy } from './fixtures.ts';

/** The parts of apps/web's handler module this file uses. */
interface HandlerModule {
  createUploadsHandler: (deps: {
    appOrigin: string;
    guard: (headers: Headers, action: 'edit-brands') => Promise<unknown>;
    rateLimit: (ctx: WorkspaceCtx, userId: string) => Promise<boolean>;
    checkRound: typeof checkUploadRound;
    start: (ctx: WorkspaceCtx, round: UploadRound) => Promise<StartedUploads>;
    sign: (
      ctx: WorkspaceCtx,
      key: string,
      upload: { contentType: string; size: number },
    ) => Promise<unknown>;
  }) => (request: Request) => Promise<Response>;
  UPLOAD_ROUNDS_PER_WINDOW: number;
  UPLOAD_WINDOW_SECONDS: number;
}

interface Answer {
  uploads?: { assetId: string; upload: { method: string; url: string } }[];
  error?: string;
}

const web = loadEnv('web');
let t: Tenancy;
let storage: Storage;
let handler: (request: Request) => Promise<Response>;
let limits: Pick<HandlerModule, 'UPLOAD_ROUNDS_PER_WINDOW'>;
/** The jobs the handler queued, each with the workspace it named. */
const queued: Payload<'asset'>[] = [];
/** A Viewer of A, and the session cookies of A's Owner and Viewer and of B's Owner. */
let viewer: Person;
const cookies = { a: '', viewer: '', b: '' };

beforeAll(async () => {
  const module = (await import(
    new URL('../../apps/web/src/app/api/uploads/handler.ts', import.meta.url).href
  )) as HandlerModule;
  limits = module;
  t = await setUpTenancy('uploads');
  storage = createStorage(web);
  handler = module.createUploadsHandler({
    appOrigin: web.APP_URL,
    guard: (headers, action) => guard().check(headers, action),
    rateLimit: (ctx, userId) =>
      hitWorkspaceRateLimit(
        t.app,
        ctx,
        `uploads:${userId}`,
        module.UPLOAD_ROUNDS_PER_WINDOW,
        module.UPLOAD_WINDOW_SECONDS,
      ),
    checkRound: checkUploadRound,
    start: (ctx, round) =>
      startUploads(
        t.app,
        (payload) => {
          queued.push(payload);
          return Promise.resolve(randomUUIDv7());
        },
        ctx,
        round,
        ({ plan, usedBytes, addingBytes }) =>
          checkStorage({ ...storagePlans(plans, plan), usedBytes, addingBytes }),
      ),
    sign: (ctx, key, upload) =>
      storage.signUpload(ctx, key, upload, {
        maxBytes: MAX_UPLOAD_BYTES,
        contentTypes: [...UPLOAD_TYPES],
      }),
  });

  // A Viewer of A: a member who may see A's brands but not add to them (§15).
  const email = `uploads-viewer-${t.run}@tenancy.invalid`;
  const [row] = await t.asOwner(
    text`insert into "user" (name, email) values (${`Tenancy viewer ${t.run}`}, ${email}) returning id`,
  );
  viewer = { id: String(row?.id), email };
  await t.app
    .forWorkspace(t.a.ctx)
    .transaction((tx) =>
      tx
        .insert(member)
        .values({ workspaceId: t.a.ctx.workspaceId, userId: viewer.id, role: 'viewer' }),
    );
  cookies.a = await t.signIn(t.a.owner);
  cookies.viewer = await t.signIn(viewer);
  cookies.b = await t.signIn(t.b.owner);
}, 60_000);

afterAll(async () => {
  storage.close();
  // Deleting the workspaces (in `close`) removes the rounds' rows and the limiter's hits with them.
  await t.close();
});

const photo = { kind: 'photo', contentType: 'image/png', size: 1000 };

function ask(cookie: string, brandId: string, files: unknown[] = [photo]): Request {
  return new Request(`${web.APP_URL}/api/uploads`, {
    method: 'POST',
    headers: {
      ...Object.fromEntries(headersWith(cookie)),
      'content-type': 'application/json',
      origin: web.APP_URL,
    },
    body: JSON.stringify({ brandId, files }),
  });
}

/** Every asset of a brand, as the owner role (which row-level security doesn't bind) finds them, but the fixture's. */
const newAssetsOf = async (brandId: string, fixture: string) =>
  (await t.asOwner(text`select id, workspace_id from asset where brand_id = ${brandId}`)).filter(
    (row) => row.id !== fixture,
  );

describe('POST /api/uploads, on the real guard, database and signer', () => {
  it('starts a round for A’s Owner in A’s brand: a waiting row in A, its job named in A, a link under A’s key', async () => {
    const response = await handler(ask(cookies.a, t.a.brand.id));
    expect(response.status).toBe(200);
    const { uploads = [] } = (await response.json()) as Answer;
    expect(uploads).toHaveLength(1);
    const [first] = uploads;
    if (first === undefined) throw new Error('no upload in the answer');
    const { assetId, upload } = first;
    const key = assetKey(t.a.ctx, { brandId: t.a.brand.id, assetId, variant: 'original' });
    expect(upload.method).toBe('PUT');
    expect(upload.url).toContain(key);
    expect(
      await t.asOwner(
        text`select workspace_id, status, source, uploaded_by, storage_key from asset where id = ${assetId}`,
      ),
    ).toEqual([
      {
        workspace_id: t.a.ctx.workspaceId,
        status: 'waiting',
        source: 'own',
        uploaded_by: t.a.owner.id,
        storage_key: key,
      },
    ]);
    expect(queued.at(-1)).toEqual({
      workspaceId: t.a.ctx.workspaceId,
      brandId: t.a.brand.id,
      assetId,
    });
    await t.asOwner(text`delete from asset where id = ${assetId}`);
  });

  it('runs the guard first: no session is refused, and nothing is added', async () => {
    const before = queued.length;
    const response = await handler(ask('better-auth.session_token=forged', t.a.brand.id));
    expect(response.status).toBe(401);
    expect(queued).toHaveLength(before);
    expect(await newAssetsOf(t.a.brand.id, t.a.asset.id)).toEqual([]);
  });

  it('refuses A’s Viewer (`edit-brands` is Owner, Admin and Editor), and adds nothing', async () => {
    const before = queued.length;
    const response = await handler(ask(cookies.viewer, t.a.brand.id));
    expect(response.status).toBe(403);
    expect(queued).toHaveLength(before);
    expect(await newAssetsOf(t.a.brand.id, t.a.asset.id)).toEqual([]);
  });

  it('never finds A’s brand for B’s Owner: 404, nothing added in A or in B', async () => {
    const before = queued.length;
    const response = await handler(ask(cookies.b, t.a.brand.id));
    expect(response.status).toBe(404);
    const body = await response.text();
    for (const trace of [t.a.ctx.workspaceId, t.a.name, t.a.brand.nameEn]) {
      expect(body).not.toContain(trace);
    }
    expect(queued).toHaveLength(before);
    expect(await newAssetsOf(t.a.brand.id, t.a.asset.id)).toEqual([]);
    expect(
      await t.asOwner(
        text`select id from asset where workspace_id = ${t.b.ctx.workspaceId} and id <> ${t.b.asset.id}`,
      ),
    ).toEqual([]);
  });

  it('refuses a round past the plan’s storage with the next-plan message, and adds nothing', async () => {
    // A has no plan set (billing sets it), so it is held to Starter's 10 GB; a file of A's already takes all of it.
    const full = randomUUIDv7();
    const key = assetKey(t.a.ctx, { brandId: t.a.brand.id, assetId: full, variant: 'original' });
    await t.asOwner(
      text`insert into asset (id, workspace_id, brand_id, kind, storage_key, source, size_bytes)
           values (${full}, ${t.a.ctx.workspaceId}, ${t.a.brand.id}, 'photo', ${key}, 'own', ${String(10 * GB)})`,
    );
    try {
      const before = queued.length;
      const response = await handler(ask(cookies.a, t.a.brand.id));
      expect(response.status).toBe(403);
      expect(((await response.json()) as Answer).error).toBe(
        'These files would go past the 10 GB of storage in your Starter plan. The Agency plan has 50 GB.',
      );
      expect(queued).toHaveLength(before);
      expect((await newAssetsOf(t.a.brand.id, t.a.asset.id)).map((row) => row.id)).toEqual([full]);
    } finally {
      await t.asOwner(text`delete from asset where id = ${full}`);
    }
  });

  it('rate limits a member’s rounds in Postgres, as the app role: the next round past the limit is refused', async () => {
    // Each refused GIF round still counts (the limit comes before the round's rules), and adds nothing.
    const gif = [{ ...photo, contentType: 'image/gif' }];
    for (let n = 0; n < limits.UPLOAD_ROUNDS_PER_WINDOW; n += 1) {
      expect((await handler(ask(cookies.b, t.b.brand.id, gif))).status, String(n)).toBe(400);
    }
    const refused = await handler(ask(cookies.b, t.b.brand.id));
    expect(refused.status).toBe(429);
    // B's limit is B's Owner's alone: A's Owner, in A, still uploads.
    const other = await handler(ask(cookies.a, t.a.brand.id));
    expect(other.status).toBe(200);
  });
});
