// The tenancy suite's fixtures (§13 Keeping workspaces apart, §17): workspaces A and B, a member of each, and one
// person in both (for switching), with rows of their own in each workspace, and a real sign-in for any of them.
//
// Every test file sets up its own (`setUpTenancy`), with this run's ids and addresses, and removes all of it after:
// the services files share one database and run side by side. The people and the rows the app role can't write go in
// as the owner role (as tests/journeys/data.int.test.ts and tests/lib/sign-in.ts do); the workspaces are made by
// packages/auth's `createWorkspace`, as the app makes them, and the second memberships by the app role, in the
// workspace's own unit of work.
//
// Signing in goes through packages/auth's real handler, the one apps/web's route serves (`authServer()`, the web
// process's own, which the route and the guard use too): the link is asked for, its email is read from the account
// emails' outbox, and the link is opened. No cookie is made by hand.
import { randomInt, randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '../../config/env.ts';
import { authServer, signInBucket } from '../../packages/auth/src/index.ts';
import { BrandKitSchema } from '../../packages/core/src/index.ts';
import {
  asset,
  brandKits,
  createDb,
  emailMessage,
  installJobs,
  invitation,
  member,
  migrate,
  type Db,
  type WorkspaceCtx,
} from '../../packages/db/src/index.ts';
import { assetKey } from '../../packages/storage/src/index.ts';

/** A result row: the columns by name. */
export type Row = Record<string, unknown>;

/**
 * A query as text: each `${value}` becomes a quoted SQL literal, as in tests/journeys/data.int.test.ts. For what has
 * no Drizzle schema the root may import (Better Auth's `user`, `session` and `account_email`, `rate_limit_hit`) and
 * the clean-up. Every value is one this suite made.
 */
export function text(strings: TemplateStringsArray, ...values: string[]): string {
  let query = '';
  strings.forEach((part, i) => {
    query += part;
    const value = values[i];
    if (value !== undefined) query += `'${value.replaceAll("'", "''")}'`;
  });
  return query;
}

export interface Person {
  readonly id: string;
  readonly email: string;
}

/** One workspace's own rows: what must never show in the other. */
export interface WorkspaceRows {
  readonly ctx: WorkspaceCtx;
  readonly name: string;
  /** The Owner: the member of this workspace alone. */
  readonly owner: Person;
  readonly invitation: { readonly id: string; readonly email: string };
  /** An outbox row, queued with no job (so no worker sends it while the suite runs). */
  readonly email: { readonly id: string; readonly to: string };
  /** A brand, with one saved kit version (#399), made by the app's own save helper. */
  readonly brand: { readonly id: string; readonly nameEn: string; readonly versionId: string };
  /** A photo in that brand's library (#400), still waiting to be processed, added by the app role. */
  readonly asset: {
    readonly id: string;
    readonly storageKey: string;
    readonly description: string;
  };
}

export interface Tenancy {
  readonly run: string;
  readonly a: WorkspaceRows;
  readonly b: WorkspaceRows;
  /** A member (Editor) of both A and B. */
  readonly both: Person;
  /** The app role's handle (lzp_app, DATABASE_URL): row-level security applies. */
  readonly app: Db;
  /** A query run by the owner role (the tables' owner, which row-level security doesn't bind). */
  asOwner: (query: string) => Promise<Row[]>;
  /**
   * An IP of its own for one request for a link (§13's limits count them per IP and per address), whose rate-limit
   * buckets, the IP's and `email`'s, `close` removes.
   */
  clientIp: (email: string) => string;
  /** Signs `person` in through the real flow; their session cookie, `name=value`. */
  signIn: (person: Person) => Promise<string>;
  /** The session row behind a cookie, as the database holds it. */
  sessionOf: (cookie: string) => Promise<{ token: string; activeWorkspaceId: string | null }>;
  /** Removes everything `setUpTenancy` made, and closes its handles. */
  close: () => Promise<void>;
}

export const headersWith = (cookie: string) => new Headers({ cookie });

/** Sets up A, B, their people and rows. `label` keeps one file's fixtures apart from another's in names and addresses. */
export async function setUpTenancy(label: string): Promise<Tenancy> {
  const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
  const web = loadEnv('web');
  await migrate(ownerUrl);
  await installJobs(ownerUrl);

  const run = randomUUID();
  const suffix = `-${run}@tenancy.invalid`;
  const app = createDb(web.DATABASE_URL);
  const ownerDb = createDb(ownerUrl);
  const server = authServer();
  const buckets = new Set<string>();

  const asOwner = async (query: string) =>
    // The owner role isn't bound by row-level security, but `forWorkspace` is the one door in; any workspace id will do.
    ownerDb
      .forWorkspace({ workspaceId: randomUUIDv7() })
      .transaction(async (tx) => (await tx.execute<Row>(query)).rows);

  const person = async (name: string): Promise<Person> => {
    const email = `${label}-${name}${suffix}`;
    const [row] = await asOwner(
      text`insert into "user" (name, email) values (${`Tenancy ${name} ${run}`}, ${email}) returning id`,
    );
    return { id: String(row?.id), email };
  };

  const workspaceWith = async (letter: 'a' | 'b'): Promise<WorkspaceRows> => {
    const owner = await person(`owner-${letter}`);
    const name = `Tenancy ${letter.toUpperCase()} ${run}`;
    const { id } = await server.createWorkspace(
      { userId: owner.id },
      { name, slug: `${label}-${letter}-${run}` },
    );
    const ctx = { workspaceId: id };
    const rows = await app.forWorkspace(ctx).transaction(async (tx) => {
      const [invited] = await tx
        .insert(invitation)
        .values({
          workspaceId: id,
          email: `invited-${letter}${suffix}`,
          role: 'editor',
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          inviterId: owner.id,
        })
        .returning({ id: invitation.id, email: invitation.email });
      const [queued] = await tx
        .insert(emailMessage)
        .values({
          workspaceId: id,
          template: 'email-check',
          toAddress: `outbox-${letter}${suffix}`,
          data: { name: `Tenancy ${letter}` },
        })
        .returning({ id: emailMessage.id, to: emailMessage.toAddress });
      if (invited === undefined || queued === undefined) throw new Error('fixture rows not made');
      return { invitation: invited, email: queued };
    });
    const kits = brandKits(app, BrandKitSchema);
    const nameEn = `Tenancy brand ${letter} ${run}`;
    const made = await kits.createBrand(ctx, { nameEn }, () => true);
    const saved = await kits.saveKit(ctx, made.id, {
      identity: {},
      voice: {},
      facts: {},
      look: {},
      rules: {},
      publishing: {},
      holidays: {},
    });
    // Its key is the one @lzp/storage gives the original, which the table's check holds it to.
    const assetId = randomUUIDv7();
    const description = `Tenancy photo ${letter} ${run}`;
    const [added] = await app.forWorkspace(ctx).transaction((tx) =>
      tx
        .insert(asset)
        .values({
          id: assetId,
          workspaceId: id,
          brandId: made.id,
          kind: 'photo',
          storageKey: assetKey(ctx, { brandId: made.id, assetId, variant: 'original' }),
          source: 'own',
          description,
          uploadedBy: owner.id,
        })
        .returning({ id: asset.id, storageKey: asset.storageKey }),
    );
    if (added === undefined) throw new Error('fixture asset not made');
    return {
      ctx,
      name,
      owner,
      ...rows,
      brand: { id: made.id, nameEn, versionId: saved.id },
      asset: { ...added, description },
    };
  };

  const a = await workspaceWith('a');
  const b = await workspaceWith('b');
  const both = await person('both');
  for (const { ctx } of [a, b]) {
    await app
      .forWorkspace(ctx)
      .transaction((tx) =>
        tx.insert(member).values({ workspaceId: ctx.workspaceId, userId: both.id, role: 'editor' }),
      );
  }

  const clientIp = (email: string) => {
    const ip = `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`;
    buckets.add(signInBucket(web.AUTH_SECRET, 'ip', ip));
    buckets.add(signInBucket(web.AUTH_SECRET, 'address', email.trim().toLowerCase()));
    return ip;
  };

  const signIn = async ({ email }: Person): Promise<string> => {
    const ip = clientIp(email);
    const pending: (() => Promise<void>)[] = [];
    const asked = await server.handler(
      new Request(`${web.APP_URL}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: web.APP_URL, 'x-forwarded-for': ip },
        body: JSON.stringify({ email, callbackURL: '/app' }),
      }),
      (task) => {
        pending.push(task);
      },
    );
    if (asked.status !== 200) throw new Error(`sign-in link refused: ${String(asked.status)}`);
    for (const task of pending) await task();
    const [sent] = await asOwner(
      text`select data from account_email where to_address = ${email} order by created_at desc limit 1`,
    );
    const url = (sent?.data as { url?: string } | undefined)?.url;
    if (url === undefined) throw new Error('no sign-in link in the account emails’ outbox');
    const opened = await server.handler(new Request(url), () => undefined);
    const cookie = opened.headers
      .getSetCookie()
      .find((each) => /session_token=[^;]+/.test(each))
      ?.split(';')[0];
    if (cookie === undefined) throw new Error('the link signed nobody in');
    return cookie;
  };

  const sessionOf = async (cookie: string) => {
    const found = await server.getSession(headersWith(cookie));
    if (found === null) throw new Error('no session');
    const [row] = await asOwner(
      text`select token, active_workspace_id from session where token = ${found.session.token}`,
    );
    return {
      token: String(row?.token),
      activeWorkspaceId: (row?.active_workspace_id as string | null | undefined) ?? null,
    };
  };

  const close = async () => {
    // Deleting a workspace removes its members, invitations, outbox rows and brands with it (and a brand its kit
    // versions and its assets); a person's sessions and account emails go with them.
    await asOwner(
      text`delete from workspace where id in (${a.ctx.workspaceId}, ${b.ctx.workspaceId})`,
    );
    await asOwner(text`delete from "user" where email like ${`%${suffix}`}`);
    for (const bucket of buckets) {
      await asOwner(text`delete from rate_limit_hit where bucket = ${bucket}`);
    }
    await server.close();
    await app.close();
    await ownerDb.close();
  };

  return { run, a, b, both, app, asOwner, clientIp, signIn, sessionOf, close };
}
