// Switching workspaces (§15 Workspaces, §15 Done when: "the workspace switcher never shows another workspace's data
// (the §13 tenancy suite covers switching)"), and the fixtures this suite stands on.
//
// The switcher's server action, `switchWorkspace`, is `guard().switchTo(await headers(), id)` (apps/web's
// app/app/actions.ts). Next's `headers()` works only inside a request Next is serving, and a test here can't stand in
// for it (`next/headers` resolves only from apps/web, so a mock from tests/ doesn't reach the action's import). So the
// action is tried through the call it makes: the same `guard()`, packages/auth's one for the web process, given the
// headers a request with the session's cookie brings, and the id the action passes on ('' for what isn't an id).
// What a signed-in page shows comes from `guard().open` (the layout's switcher and the page's workspace), and its rows
// from `forWorkspace` on the workspace it opened: both are checked after every switch.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authServer, guard } from '../../packages/auth/src/index.ts';
import { emailMessage, invitation } from '../../packages/db/src/index.ts';
import { headersWith, setUpTenancy, type Tenancy, type WorkspaceRows } from './fixtures.ts';
import { tenancy } from './tenancy.ts';

let t: Tenancy;

beforeAll(async () => {
  t = await setUpTenancy('switch');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** What a signed-in page shows the cookie's person: the workspace it opens, the switcher's list, and its rows. */
async function shown(cookie: string) {
  const opened = await guard().open(headersWith(cookie));
  if (!opened.ok) return { opened, invitations: [], emails: [] };
  const ctx = { workspaceId: opened.workspace.id };
  const [invitations, emails] = await t.app
    .forWorkspace(ctx)
    .transaction(async (tx) => [
      await tx.select({ id: invitation.id, workspaceId: invitation.workspaceId }).from(invitation),
      await tx
        .select({ id: emailMessage.id, workspaceId: emailMessage.workspaceId })
        .from(emailMessage),
    ]);
  return { opened, invitations, emails };
}

/** The page shows `w` and its rows, and nothing of `other`'s. */
function expectShows(
  page: Awaited<ReturnType<typeof shown>>,
  w: WorkspaceRows,
  other: WorkspaceRows,
) {
  expect(page.opened.ok && page.opened.workspace.id).toBe(w.ctx.workspaceId);
  const ids = [...page.invitations, ...page.emails].map((row) => row.id);
  expect(ids).toEqual(expect.arrayContaining([w.invitation.id, w.email.id]));
  expect(ids).not.toContain(other.invitation.id);
  expect(ids).not.toContain(other.email.id);
  expect(
    [...page.invitations, ...page.emails].every((row) => row.workspaceId === w.ctx.workspaceId),
  ).toBe(true);
}

describe('the fixtures', () => {
  it('make workspaces A and B, with a member each, and one person in both', async () => {
    const workspacesOf = async (userId: string) =>
      (await authServer().listWorkspaces({ userId })).map((each) => each.id).sort();
    const { a, b, both } = t;
    expect(a.ctx.workspaceId).not.toBe(b.ctx.workspaceId);
    expect(await workspacesOf(a.owner.id)).toEqual([a.ctx.workspaceId]);
    expect(await workspacesOf(b.owner.id)).toEqual([b.ctx.workspaceId]);
    expect(await workspacesOf(both.id)).toEqual([a.ctx.workspaceId, b.ctx.workspaceId].sort());
  });
});

tenancy('action apps/web/src/app/app/actions.ts#switchWorkspace', () => {
  it('refuses a member of A alone a switch into B; the session, and what the page shows, stay A’s', async () => {
    const cookie = await t.signIn(t.a.owner);
    const before = shown(cookie);
    expectShows(await before, t.a, t.b);

    expect(await guard().switchTo(headersWith(cookie), t.b.ctx.workspaceId)).toEqual({
      ok: false,
      refused: 'not-a-member',
    });
    // What the action passes on for anything that isn't a workspace id.
    expect(await guard().switchTo(headersWith(cookie), '')).toEqual({
      ok: false,
      refused: 'not-a-member',
    });
    expect((await t.sessionOf(cookie)).activeWorkspaceId).toBe(t.a.ctx.workspaceId);
    const after = await shown(cookie);
    expectShows(after, t.a, t.b);
    // The switcher lists A alone: B isn't even named.
    expect(after.opened.ok && after.opened.workspaces.map((each) => each.id)).toEqual([
      t.a.ctx.workspaceId,
    ]);
  });

  it('refuses a request with no session, whatever workspace it names', async () => {
    expect(await guard().switchTo(new Headers(), t.b.ctx.workspaceId)).toEqual({
      ok: false,
      refused: 'no-session',
    });
  });

  it('after switching between one’s own workspaces, nothing from the other shows', async () => {
    const cookie = await t.signIn(t.both);
    // A new session opens in the first workspace by name: A.
    expectShows(await shown(cookie), t.a, t.b);

    expect(await guard().switchTo(headersWith(cookie), t.b.ctx.workspaceId)).toEqual({ ok: true });
    expect((await t.sessionOf(cookie)).activeWorkspaceId).toBe(t.b.ctx.workspaceId);
    expectShows(await shown(cookie), t.b, t.a);

    expect(await guard().switchTo(headersWith(cookie), t.a.ctx.workspaceId)).toEqual({ ok: true });
    expectShows(await shown(cookie), t.a, t.b);
  });

  it('a switch on one session leaves the person’s other sessions where they were', async () => {
    const first = await t.signIn(t.both);
    const second = await t.signIn(t.both);
    expectShows(await shown(first), t.a, t.b);
    expectShows(await shown(second), t.a, t.b);
    expect(await guard().switchTo(headersWith(second), t.b.ctx.workspaceId)).toEqual({ ok: true });
    expectShows(await shown(first), t.a, t.b);
    expectShows(await shown(second), t.b, t.a);
  });
});
