// The upload route's handler on the real services (#403, §13 Keeping workspaces apart, The app's API, File storage;
// §15's matrix, `edit-brands`): apps/web's own `uploadsDeps` (deps.ts), so the real guard and sessions, the app role's
// database with its row-level security, the app role's rate limiter, @lzp/core's upload rules and storage limit with
// config/plans.ts, and the real signer. The guard runs first: no session, a Viewer, and another workspace's member are
// refused, and nothing is added; a brand of another workspace is never found; a round past the plan's storage is
// refused with the next-plan message.
//
// A member is signed in, then opens the app (`guard().open`, as a signed-in page does), which gives the session its
// workspace: the route works in the session's workspace and never takes one from the request.
//
// One difference from the app: the `asset` job is recorded, not queued, so no worker of another services file picks
// up a file that never arrives (packages/db's uploads.int.test.ts checks that the jobs go in the rows' own transaction;
// the feature's journey runs the real queue). The modules are loaded by URL, as routes.test.ts loads apps/web's: the
// root's typecheck reads no apps/web dependency.
//
// It isn't a `tenancy('route POST /api/uploads', …)` block yet: apps/web serves no /api/uploads (route.ts) until
// @lzp/storage type-checks in apps/web (#403's PR, needs-zeus), and the inventory refuses a block for a route the app
// doesn't have. The route's block is this file's tests, moved under it with route.ts.
import { randomUUIDv7 } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { guard } from '../../packages/auth/src/index.ts';
import { GB } from '../../packages/core/src/index.ts';
import { member, type Db, type Payload, type SendAssetJob } from '../../packages/db/src/index.ts';
import { assetKey, createStorage, type Storage } from '../../packages/storage/src/index.ts';
import { headersWith, setUpTenancy, text, type Person, type Tenancy } from './fixtures.ts';

/** The parts of apps/web's handler.ts and deps.ts this file uses. */
interface HandlerModule {
  createUploadsHandler: (deps: unknown) => (request: Request) => Promise<Response>;
  UPLOAD_ROUNDS_PER_WINDOW: number;
}
interface DepsModule {
  uploadsDeps: (services: {
    appOrigin: string;
    db: Db;
    send: SendAssetJob;
    storage: Pick<Storage, 'signUpload'>;
  }) => unknown;
}

const load = async <T>(file: string): Promise<T> =>
  (await import(new URL(`../../apps/web/src/app/api/uploads/${file}`, import.meta.url).href)) as T;

interface Answer {
  uploads?: { assetId: string; upload: { method: string; url: string } }[];
  error?: string;
}

const web = loadEnv('web');
let t: Tenancy;
let storage: Storage;
let handler: (request: Request) => Promise<Response>;
let roundsPerWindow: number;
/** The jobs the handler queued, each with the workspace it named. */
const queued: Payload<'asset'>[] = [];
/** Session cookies, each opened in its workspace: A's Owner and Viewer, B's Owner, and an Editor of B for the limit. */
const cookies = { a: '', viewer: '', b: '', limited: '' };

/** A person of this run, made a member of `ws` with `role` by the app role, in the workspace's own unit of work. */
async function memberOf(
  ws: Tenancy['a'],
  name: string,
  role: 'viewer' | 'editor',
): Promise<Person> {
  const email = `uploads-${name}-${t.run}@tenancy.invalid`;
  const [row] = await t.asOwner(
    text`insert into "user" (name, email) values (${`Tenancy ${name} ${t.run}`}, ${email}) returning id`,
  );
  const person = { id: String(row?.id), email };
  await t.app
    .forWorkspace(ws.ctx)
    .transaction((tx) =>
      tx.insert(member).values({ workspaceId: ws.ctx.workspaceId, userId: person.id, role }),
    );
  return person;
}

/** Signs `person` in and opens the app, as the first signed-in page does: the session's workspace is then `ws`. */
async function signedInto(person: Person, ws: Tenancy['a']): Promise<string> {
  const cookie = await t.signIn(person);
  const opened = await guard().open(headersWith(cookie));
  if (!opened.ok || opened.workspace.id !== ws.ctx.workspaceId) {
    throw new Error('the session didn’t open in the member’s workspace');
  }
  return cookie;
}

beforeAll(async () => {
  const [handlerModule, depsModule] = await Promise.all([
    load<HandlerModule>('handler.ts'),
    load<DepsModule>('deps.ts'),
  ]);
  roundsPerWindow = handlerModule.UPLOAD_ROUNDS_PER_WINDOW;
  t = await setUpTenancy('uploads');
  storage = createStorage(web);
  handler = handlerModule.createUploadsHandler(
    depsModule.uploadsDeps({
      appOrigin: web.APP_URL,
      db: t.app,
      send: (payload) => {
        queued.push(payload);
        return Promise.resolve(randomUUIDv7());
      },
      storage,
    }),
  );

  // A Viewer of A (§15: sees A's brands, can't add to them), and an Editor of B whose limit nothing else spends.
  // The users' emails end like the fixture's, so `close` removes them too.
  const viewer = await memberOf(t.a, 'viewer', 'viewer');
  const limited = await memberOf(t.b, 'limited', 'editor');
  cookies.a = await signedInto(t.a.owner, t.a);
  cookies.viewer = await signedInto(viewer, t.a);
  cookies.b = await signedInto(t.b.owner, t.b);
  cookies.limited = await signedInto(limited, t.b);
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
        text`select workspace_id, status, source, uploaded_by, storage_key, size_bytes::text as size_bytes from asset where id = ${assetId}`,
      ),
    ).toEqual([
      {
        workspace_id: t.a.ctx.workspaceId,
        status: 'waiting',
        source: 'own',
        uploaded_by: t.a.owner.id,
        storage_key: key,
        // The size the link is signed for, which the plan's storage counts until the job reads the file.
        size_bytes: '1000',
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
    // Refused for the role, in A: not for a missing workspace.
    expect(((await response.json()) as Answer).error).toBe('Your role can’t add files to a brand.');
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
    // A has no plan set (billing sets it), so it is held to Starter's 10 GB (Zeus, 2026-11-26, on #403); a file of
    // A's already takes all of it.
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

  it('rate limits a member’s rounds in Postgres, as the app role: the round past 20 a minute is refused', async () => {
    // Each refused GIF round still counts (the limit comes before the round's rules), and adds nothing.
    expect(roundsPerWindow).toBe(20);
    const gif = [{ ...photo, contentType: 'image/gif' }];
    for (let n = 1; n <= roundsPerWindow; n += 1) {
      const response = await handler(ask(cookies.limited, t.b.brand.id, gif));
      expect(response.status, `round ${String(n)}`).toBe(400);
    }
    const refused = await handler(ask(cookies.limited, t.b.brand.id));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(
      await t.asOwner(
        text`select id from asset where workspace_id = ${t.b.ctx.workspaceId} and id <> ${t.b.asset.id}`,
      ),
    ).toEqual([]);
    // The limit is that member's alone: B's Owner, in the same workspace, still uploads.
    const other = await handler(ask(cookies.b, t.b.brand.id));
    expect(other.status).toBe(200);
  });
});
