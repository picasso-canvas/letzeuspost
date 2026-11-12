// The guard every server action, route handler and signed-in page starts with (§13 The app's API, #79): the session,
// then the active workspace (the session's, never the request's), then the person's role in it, then §15's matrix
// (#66). Checked here without a database: the session, the person's workspaces and the session's active workspace are
// given to it. guard.int.test.ts runs the same steps on Postgres through packages/auth's server.
import { describe, expect, it } from 'vitest';
import { createGuard, type GuardDeps, type GuardSession } from './guard.ts';

const NADIA = '01970000-0000-7000-8000-00000000000a';
const NORTHWIND = '01970000-0000-7000-8000-0000000000b1';
const KITE = '01970000-0000-7000-8000-0000000000b2';
const ELSEWHERE = '01970000-0000-7000-8000-0000000000b3';
const TOKEN = 'session-token';

const northwind = { id: NORTHWIND, name: 'Northwind Social', slug: 'northwind', role: 'editor' };
const kite = { id: KITE, name: 'Kite & Co', slug: 'kite', role: 'viewer' };

interface World {
  /** The session the request carries, or null for none. */
  session: GuardSession | null;
  /** The person's workspaces, as `listWorkspaces` returns them (sorted by name). */
  workspaces: {
    id: string;
    name: string;
    slug: string;
    role: 'owner' | 'admin' | 'editor' | 'viewer';
  }[];
}

/** The deps over a small world, recording each call so the order of the steps can be checked. */
function world(start: Partial<World> = {}) {
  const state: World = {
    session: {
      session: { token: TOKEN, userId: NADIA, activeWorkspaceId: NORTHWIND },
      user: { id: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
    },
    workspaces: [kite, northwind] as World['workspaces'],
    ...start,
  };
  const calls: string[] = [];
  const deps: GuardDeps = {
    getSession: (headers) => {
      calls.push(`getSession(${headers.get('cookie') ?? ''})`);
      return Promise.resolve(state.session);
    },
    listWorkspaces: (person) => {
      calls.push(`listWorkspaces(${person.userId})`);
      return Promise.resolve(state.workspaces);
    },
    setActiveWorkspace: (session, workspaceId) => {
      calls.push(`setActiveWorkspace(${session.token}, ${workspaceId})`);
      const isMember = state.workspaces.some((w) => w.id === workspaceId);
      if (!isMember || state.session?.session.token !== session.token) {
        return Promise.resolve(false);
      }
      state.session = {
        ...state.session,
        session: { ...state.session.session, activeWorkspaceId: workspaceId },
      };
      return Promise.resolve(true);
    },
  };
  return { state, calls, guard: createGuard(deps) };
}

const request = (extra: Record<string, string> = {}) =>
  new Headers({ cookie: 'better-auth.session_token=abc', ...extra });

describe('check: session, then workspace, then role, then permission', () => {
  it('lets a member through for what their role may do, with the workspace from the session', async () => {
    const { guard, calls } = world();
    const result = await guard.check(request(), 'make-posts');
    expect(result).toEqual({
      ok: true,
      person: { userId: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
      session: { token: TOKEN, userId: NADIA },
      workspace: northwind,
      workspaces: [kite, northwind],
    });
    expect(calls).toEqual([
      'getSession(better-auth.session_token=abc)',
      `listWorkspaces(${NADIA})`,
    ]);
  });

  it('refuses with no session, and asks nothing else', async () => {
    const { guard, calls } = world({ session: null });
    expect(await guard.check(request(), 'see-workspace')).toEqual({
      ok: false,
      refused: 'no-session',
    });
    expect(calls).toEqual(['getSession(better-auth.session_token=abc)']);
  });

  it('refuses a session with no active workspace, before reading memberships', async () => {
    const { guard, calls } = world({
      session: {
        session: { token: TOKEN, userId: NADIA, activeWorkspaceId: null },
        user: { id: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
      },
    });
    expect(await guard.check(request(), 'see-workspace')).toEqual({
      ok: false,
      refused: 'no-workspace',
    });
    expect(calls).toEqual(['getSession(better-auth.session_token=abc)']);
  });

  it('refuses when the person is no longer a member of the session’s workspace', async () => {
    const { guard } = world({ workspaces: [kite] as World['workspaces'] });
    expect(await guard.check(request(), 'see-workspace')).toEqual({
      ok: false,
      refused: 'not-a-member',
    });
  });

  it('refuses what the member’s role may not do (§15: an Editor manages no billing)', async () => {
    const { guard } = world();
    expect(await guard.check(request(), 'manage-billing')).toEqual({
      ok: false,
      refused: 'not-allowed',
    });
  });

  it('takes the role from the membership: a Viewer may see the workspace but not make posts', async () => {
    const { guard } = world({
      session: {
        session: { token: TOKEN, userId: NADIA, activeWorkspaceId: KITE },
        user: { id: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
      },
    });
    expect((await guard.check(request(), 'see-workspace')).ok).toBe(true);
    expect(await guard.check(request(), 'make-posts')).toEqual({
      ok: false,
      refused: 'not-allowed',
    });
  });

  it('never takes the workspace from the request', async () => {
    const { guard } = world();
    const result = await guard.check(
      request({
        'x-workspace-id': KITE,
        cookie: `better-auth.session_token=abc; workspace=${KITE}`,
      }),
      'make-posts',
    );
    expect(result.ok && result.workspace.id).toBe(NORTHWIND);
  });

  it('refuses an action that isn’t in the matrix', async () => {
    const { guard } = world();
    expect(await guard.check(request(), 'take-over' as never)).toEqual({
      ok: false,
      refused: 'not-allowed',
    });
  });
});

describe('open: the workspace a signed-in page opens in', () => {
  it('opens the session’s workspace, the last one used, when the person is still a member of it', async () => {
    const { guard, calls } = world();
    const result = await guard.open(request());
    expect(result.ok && result.workspace.id).toBe(NORTHWIND);
    expect(calls.some((call) => call.startsWith('setActiveWorkspace'))).toBe(false);
  });

  it('with none on the session yet (just signed in), opens the first of the person’s workspaces and keeps it', async () => {
    const { guard, state } = world({
      session: {
        session: { token: TOKEN, userId: NADIA },
        user: { id: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
      },
    });
    const result = await guard.open(request());
    expect(result.ok && result.workspace.id).toBe(KITE);
    expect(state.session?.session.activeWorkspaceId).toBe(KITE);
  });

  it('when the session’s workspace is no longer the person’s, opens the first one that is', async () => {
    const { guard, state } = world({
      session: {
        session: { token: TOKEN, userId: NADIA, activeWorkspaceId: ELSEWHERE },
        user: { id: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
      },
    });
    const result = await guard.open(request());
    expect(result.ok && result.workspace.id).toBe(KITE);
    expect(state.session?.session.activeWorkspaceId).toBe(KITE);
  });

  it('refuses with no session', async () => {
    const { guard } = world({ session: null });
    expect(await guard.open(request())).toEqual({ ok: false, refused: 'no-session' });
  });

  it('refuses a person who belongs to no workspace', async () => {
    const { guard } = world({ workspaces: [] });
    expect(await guard.open(request())).toEqual({ ok: false, refused: 'no-workspace' });
  });

  it('refuses when the workspace can’t be kept on the session (the membership went in between)', async () => {
    const refusing = createGuard({
      getSession: () =>
        Promise.resolve({
          session: { token: TOKEN, userId: NADIA, activeWorkspaceId: null },
          user: { id: NADIA, name: 'Nadia Karim', email: 'nadia@northwind.invalid' },
        }),
      listWorkspaces: () => Promise.resolve([northwind] as World['workspaces']),
      setActiveWorkspace: () => Promise.resolve(false),
    });
    expect(await refusing.open(request())).toEqual({ ok: false, refused: 'not-a-member' });
  });
});

describe('switchTo: choosing a workspace in the switcher', () => {
  it('makes a workspace the person belongs to the session’s, so it is the one that opens next', async () => {
    const { guard } = world();
    expect(await guard.switchTo(request(), KITE)).toEqual({ ok: true });
    const opened = await guard.open(request());
    expect(opened.ok && opened.workspace.id).toBe(KITE);
  });

  it('refuses a workspace the person doesn’t belong to, and the session keeps its own', async () => {
    const { guard, state } = world();
    expect(await guard.switchTo(request(), ELSEWHERE)).toEqual({
      ok: false,
      refused: 'not-a-member',
    });
    expect(state.session?.session.activeWorkspaceId).toBe(NORTHWIND);
  });

  it('refuses with no session, and changes nothing', async () => {
    const { guard, calls } = world({ session: null });
    expect(await guard.switchTo(request(), KITE)).toEqual({ ok: false, refused: 'no-session' });
    expect(calls.some((call) => call.startsWith('setActiveWorkspace'))).toBe(false);
  });

  it('switches the session the request carries, for the person it belongs to', async () => {
    const { guard, calls } = world();
    await guard.switchTo(request(), KITE);
    expect(calls).toContain(`setActiveWorkspace(${TOKEN}, ${KITE})`);
  });
});
