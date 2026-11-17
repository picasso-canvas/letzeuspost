// The M0 route handlers and Better Auth endpoints, signed in as workspace A and given workspace B's ids (§13 Keeping
// workspaces apart): each is refused, or answers with A's own and nothing of B's. The route modules are apps/web's
// own, called as Next calls them (with the request), except where a handler needs Next's request scope: asking for a
// link runs its work after the answer with Next's `after()`, so that request goes to packages/auth's handler, the one
// the route hands every request to, with the work collected and run here.
//
// The route modules are loaded by URL, not imported, as tests/journeys loads the worker: they import `next/server`,
// which resolves only from apps/web, and the root's typecheck reads no apps/web dependency (apps/web is typechecked in
// its own package). Their types here are the parts this file uses.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { authServer } from '../../packages/auth/src/index.ts';
import { headersWith, setUpTenancy, text, type Tenancy, type WorkspaceRows } from './fixtures.ts';
import { tenancy } from './tenancy.ts';

interface AuthRoute {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

interface HealthRoute {
  GET: () => Promise<Response>;
}

const appModule = async <T>(file: string) =>
  (await import(new URL(`../../apps/web/src/${file}`, import.meta.url).href)) as T;

const { APP_URL: appUrl } = loadEnv('web');
let t: Tenancy;
let authRoute: AuthRoute;
let healthRoute: HealthRoute;
/** The session cookie of A's Owner, a member of A alone. */
let cookieA = '';

beforeAll(async () => {
  authRoute = await appModule<AuthRoute>('app/api/auth/[...all]/route.ts');
  healthRoute = await appModule<HealthRoute>('app/api/health/route.ts');
  t = await setUpTenancy('routes');
  cookieA = await t.signIn(t.a.owner);
}, 60_000);

afterAll(async () => {
  await t.close();
  // The health route's handle: apps/web's one database handle, opened by the route on first use.
  const { appDb } = await appModule<{ appDb: () => { close: () => Promise<void> } }>(
    'server/db.ts',
  );
  await appDb().close();
});

/** Everything of B's a response could leak: its id, its name, its Owner, its rows. */
const traces = (w: WorkspaceRows) => [
  w.ctx.workspaceId,
  w.name,
  w.owner.id,
  w.owner.email,
  w.invitation.id,
  w.invitation.email,
  w.email.id,
  w.email.to,
];

function expectNothingOf(w: WorkspaceRows, body: string) {
  for (const trace of traces(w)) expect(body).not.toContain(trace);
}

/** B's ids, as a request would carry them: in the query, and as the names Better Auth or the app might read. */
const bIds = () =>
  new URLSearchParams({
    workspaceId: t.b.ctx.workspaceId,
    activeWorkspaceId: t.b.ctx.workspaceId,
    organizationId: t.b.ctx.workspaceId,
    userId: t.b.owner.id,
  }).toString();

const sessionCookieIn = (response: Response) =>
  response.headers.getSetCookie().some((each) => /session_token=[^;]+;/.test(each));

tenancy('route GET /api/auth/[...all]', () => {
  tenancy('auth GET /get-session', () => {
    it('answers with A’s person and A’s session, whatever ids of B’s the request carries', async () => {
      const response = await authRoute.GET(
        new Request(`${appUrl}/api/auth/get-session?${bIds()}`, {
          headers: {
            cookie: cookieA,
            'x-workspace-id': t.b.ctx.workspaceId,
            'x-active-workspace-id': t.b.ctx.workspaceId,
          },
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.text();
      const session = JSON.parse(body) as {
        user: { id: string };
        session: { userId: string; activeWorkspaceId?: string | null };
      };
      expect(session.user.id).toBe(t.a.owner.id);
      expect(session.session.userId).toBe(t.a.owner.id);
      expect([null, undefined, t.a.ctx.workspaceId]).toContain(session.session.activeWorkspaceId);
      expectNothingOf(t.b, body);
    });

    it('answers with no session at all to a request with none, B’s ids or not', async () => {
      const response = await authRoute.GET(new Request(`${appUrl}/api/auth/get-session?${bIds()}`));
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body)).toBeNull();
      expectNothingOf(t.b, body);
    });
  });

  tenancy('auth GET /magic-link/verify', () => {
    it('signs nobody in on a link A forged, B’s ids in it or not, and A’s session stays A’s', async () => {
      const before = await t.sessionOf(cookieA);
      const response = await authRoute.GET(
        new Request(
          `${appUrl}/api/auth/magic-link/verify?token=${t.b.owner.id}&callbackURL=${encodeURIComponent(`/app?${bIds()}`)}&${bIds()}`,
          { headers: { cookie: cookieA } },
        ),
      );
      expect(response.status).toBeLessThan(500);
      expect(sessionCookieIn(response)).toBe(false);
      expectNothingOf(t.b, await response.text());
      expect(await t.sessionOf(cookieA)).toEqual(before);
      // B's Owner was signed in by nobody.
      expect(await t.asOwner(text`select 1 from session where user_id = ${t.b.owner.id}`)).toEqual(
        [],
      );
    });
  });
});

tenancy('route POST /api/auth/[...all]', () => {
  tenancy('auth POST /sign-out', () => {
    it('ends A’s own session only: B’s, named in the request, goes on', async () => {
      const cookieB = await t.signIn(t.b.owner);
      const sessionB = await t.sessionOf(cookieB);
      const cookieA2 = await t.signIn(t.a.owner);
      const response = await authRoute.POST(
        new Request(`${appUrl}/api/auth/sign-out?${bIds()}`, {
          method: 'POST',
          headers: { cookie: cookieA2, origin: appUrl, 'content-type': 'application/json' },
          body: JSON.stringify({ token: sessionB.token, sessionToken: sessionB.token }),
        }),
      );
      expect(response.status).toBe(200);
      expectNothingOf(t.b, await response.text());
      expect(await authServer().getSession(headersWith(cookieA2))).toBeNull();
      expect(await t.sessionOf(cookieB)).toEqual(sessionB);
    });
  });

  tenancy('auth POST /sign-in/magic-link', () => {
    it('answers A as it answers anyone, sends B’s link to B’s own address alone, and leaves A’s session as it was', async () => {
      const before = await t.sessionOf(cookieA);
      /** The links in the account emails' outbox: whose, and to which address. */
      const links = async () =>
        t.asOwner(
          text`select user_id, to_address from account_email where user_id in (${t.a.owner.id}, ${t.b.owner.id})`,
        );
      const linksBefore = await links();
      const pending: (() => Promise<void>)[] = [];
      const response = await authServer().handler(
        new Request(`${appUrl}/api/auth/sign-in/magic-link?${bIds()}`, {
          method: 'POST',
          headers: {
            cookie: cookieA,
            origin: appUrl,
            'content-type': 'application/json',
            'x-forwarded-for': t.clientIp(t.b.owner.email),
          },
          body: JSON.stringify({ email: t.b.owner.email, callbackURL: '/app' }),
        }),
        (task) => {
          pending.push(task);
        },
      );
      for (const task of pending) await task();
      expect(response.status).toBe(200);
      expect(sessionCookieIn(response)).toBe(false);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ status: true });
      expectNothingOf(t.b, body);
      // One more link, B's Owner's, to B's Owner's own address; every link goes to its own person's address, so A
      // gets nothing of B's.
      const linksAfter = await links();
      expect(linksAfter.filter((row) => row.user_id === t.b.owner.id)).toHaveLength(
        linksBefore.filter((row) => row.user_id === t.b.owner.id).length + 1,
      );
      expect(linksAfter.filter((row) => row.user_id === t.a.owner.id)).toHaveLength(
        linksBefore.filter((row) => row.user_id === t.a.owner.id).length,
      );
      for (const row of linksAfter) {
        expect(row.to_address).toBe(
          row.user_id === t.b.owner.id ? t.b.owner.email : t.a.owner.email,
        );
      }
      expect(await t.sessionOf(cookieA)).toEqual(before);
    });
  });
});

tenancy('route GET /api/health', () => {
  it('answers with its status alone to A, B’s ids in the request or not: no workspace, no person, no row', async () => {
    // The handler takes no request (it reads nothing from it), so B's ids can't reach it; its answer is checked anyway.
    const response = await healthRoute.GET();
    const body = await response.text();
    expect(Object.keys(JSON.parse(body) as object)).toEqual(['status']);
    expectNothingOf(t.b, body);
    expectNothingOf(t.a, body);
  });
});
