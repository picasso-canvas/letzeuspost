/// <reference lib="dom" />
// The Workspaces feature's journey (§19 A task's life, #156): a person who belongs to two workspaces signs in with the
// emailed link, lands in one of them under `/app`, switches to the other with the workspace switcher and sees that
// workspace and nothing of the first, then signs out with the avatar menu; and a person in one workspace only is never
// offered the other. `tests/e2e/workspaces.spec.ts` covers the frame's states, themes and screenshots; this is the
// route a person takes, end to end.
//
// It drives the built app in the `journeys` project, with the worker running (CI's `services` job starts both). The
// people and workspaces are this run's own, made with the seeds' code before the test and removed after it
// (tests/lib/workspaces.ts); everything the test does is the app's real flow: the sign-in link asked for on `/sign-in`
// and read from Mailpit, the switcher, the avatar menu. What it relies on, from #79 and #80: the Inbox at `/app` (Q13)
// with its heading "Inbox"; the switcher (`data-slot="workspace-switcher"`), named by the current workspace's name,
// opening a menu "Workspaces" of `menuitemradio` rows, one per workspace, the current one checked; the avatar
// (`data-slot="account-menu"`), named "{name} ({role})", opening a menu "Your account" with "Sign out".
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { Seed } from '../../packages/db/src/seed/seed.ts';
import { sessionCookies, signInWithLink } from '../lib/sign-in.ts';
import { createWorkspaces } from '../lib/workspaces.ts';

// ---- The people and their workspaces ----------------------------------------------------------------------------

// Mina owns Harbour and is an Editor in Kite, whose Owner is Rafi. Rafi is in Kite only. "Harbour" comes before "Kite"
// by name, so a new session of Mina's opens in Harbour.
const run = randomUUID();
const tag = run.slice(0, 8);
const mina = { email: `mina-${run}@workspaces.invalid`, name: 'Mina Das' };
const rafi = { email: `rafi-${run}@workspaces.invalid`, name: 'Rafi Ahmed' };
const harbour: Seed = {
  workspace: { name: `Harbour ${tag}`, slug: `harbour-${run}` },
  people: [{ ...mina, role: 'owner', platformAdmin: false }],
};
const kite: Seed = {
  workspace: { name: `Kite ${tag}`, slug: `kite-${run}` },
  people: [
    { ...rafi, role: 'owner', platformAdmin: false },
    { ...mina, role: 'editor', platformAdmin: false },
  ],
};
let removeWorkspaces: (() => Promise<void>) | undefined;

// The workspaces are not the feature, so they are made in a hook: if the database is broken, the hook fails and says
// so, instead of the journey failing at a step that has nothing to do with it.
test.beforeAll(async () => {
  removeWorkspaces = await createWorkspaces([harbour, kite]);
});

test.afterAll(async () => {
  await removeWorkspaces?.();
});

// ---- What a person sees -----------------------------------------------------------------------------------------

const switcher = (page: Page) => page.locator('[data-slot="workspace-switcher"]');
const avatar = (page: Page) => page.locator('[data-slot="account-menu"]');
const workspacesMenu = (page: Page) => page.getByRole('menu', { name: 'Workspaces' });

/** The switcher shows `name` as the workspace in use, as its accessible name and as visible text on the button. */
async function inWorkspace(page: Page, name: string, who: string) {
  await expect(switcher(page)).toHaveAccessibleName(name);
  await expect(switcher(page).getByText(name, { exact: true })).toBeVisible();
  await expect(avatar(page)).toHaveAccessibleName(who);
}

// ---- The journey ------------------------------------------------------------------------------------------------

test('someone in two workspaces switches between them, then signs out; someone in one is never offered the other', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL ?? '').origin;
  const inbox = new URL('/app', origin).href;
  // Rafi is a person of his own: a context with no cookies from Mina's.
  const rafiContext = await browser.newContext({ baseURL: origin });
  try {
    // 1. Mina signs in with the emailed link and lands in her first workspace under `/app`: the Inbox, in Harbour,
    // where she is the Owner. Nothing of Kite is on the page.
    await signInWithLink(page, mina.email, origin);
    await expect(page).toHaveURL(inbox);
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await inWorkspace(page, harbour.workspace.name, `${mina.name} (Owner)`);
    await expect(page.getByText(kite.workspace.name)).toHaveCount(0);

    // 2. The switcher offers her both workspaces, with Harbour marked as the one she is in.
    await switcher(page).click();
    const menu = workspacesMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
    await expect(menu.getByRole('menuitemradio', { checked: true })).toContainText(
      harbour.workspace.name,
    );
    await expect(menu.getByRole('menuitemradio', { name: kite.workspace.name })).toBeVisible();

    // 3. She chooses Kite: the page is Kite's now, with her role there (Editor), and Harbour's name is nowhere on it.
    await menu.getByRole('menuitemradio', { name: kite.workspace.name }).click();
    await inWorkspace(page, kite.workspace.name, `${mina.name} (Editor)`);
    await expect(page.getByText(harbour.workspace.name)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();

    // 4. It stays Kite: opening the Inbox afresh shows Kite, still with nothing of Harbour.
    await page.goto('/app');
    await inWorkspace(page, kite.workspace.name, `${mina.name} (Editor)`);
    await expect(page.getByText(harbour.workspace.name)).toHaveCount(0);

    // 5. She signs out with the avatar menu: she is taken to `/sign-in`, her session is gone, and the Inbox is closed
    // to her again.
    await avatar(page).click();
    const account = page.getByRole('menu', { name: 'Your account' });
    await expect(account.getByText(`${mina.name} (Editor)`)).toBeVisible();
    await account.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(new URL('/sign-in', origin).href);
    expect(sessionCookies(await page.context().cookies())).toEqual([]);
    await page.goto('/app');
    await expect(page).toHaveURL(new URL('/sign-in', origin).href);

    // 6. Rafi, who is in Kite only, signs in and lands in Kite as its Owner. His switcher offers Kite alone, marked as
    // the one he is in, and Harbour is nowhere on the page or in the menu.
    const rafiPage = await rafiContext.newPage();
    await signInWithLink(rafiPage, rafi.email, origin);
    await expect(rafiPage).toHaveURL(inbox);
    await inWorkspace(rafiPage, kite.workspace.name, `${rafi.name} (Owner)`);
    await expect(rafiPage.getByText(harbour.workspace.name)).toHaveCount(0);
    await switcher(rafiPage).click();
    const rafiMenu = workspacesMenu(rafiPage);
    await expect(rafiMenu).toBeVisible();
    await expect(rafiMenu.getByRole('menuitemradio')).toHaveCount(1);
    await expect(rafiMenu.getByRole('menuitemradio', { checked: true })).toContainText(
      kite.workspace.name,
    );
    await expect(rafiPage.getByText(harbour.workspace.name)).toHaveCount(0);
  } finally {
    await rafiContext.close();
  }
});
