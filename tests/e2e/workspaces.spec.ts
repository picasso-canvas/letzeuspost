/// <reference lib="dom" />
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import { loadEnv } from '../../config/env.ts';
import { createDb } from '../../packages/db/src/index.ts';
import { runSeed } from '../../packages/db/src/seed/run.ts';
import { devSeed, type Seed } from '../../packages/db/src/seed/seed.ts';
import { askForLink, emailsTo, sessionCookies, signInLink } from '../lib/sign-in.ts';

// Workspaces in the app (#79), in the `app-light` and `app-dark` projects (1440 px): the people the seeds make sign in
// through the real flow (the link asked for on /sign-in, the email in Mailpit, the link opened) and land in their
// workspace under /app (Q13); a person in two workspaces switches between them and sees only the one they're in; the
// avatar menu signs out. The Inbox's frame, and its loading state, are screenshotted in both themes and checked with axe.
//
// Baselines (Q11), as in home.spec.ts: CI renders the screenshot and uploads it (`e2e-screenshots`); Iris and Zeus
// approve the first ones; then Athena commits them to tests/visual/approved/. A builder never writes that folder, so
// until a baseline exists the screenshot is only taken (and annotated).

const ownerUrl = loadEnv('migrate').DATABASE_OWNER_URL;
const origin = new URL(loadEnv('worker').APP_URL).origin;
const INBOX = '/app';

const themeOf = (projectName: string) => (projectName === 'app-dark' ? 'dark' : 'light');

/**
 * Signs `address` in on `page` and waits for the Inbox. Like tests/lib/sign-in.ts's `signInWithLink`, but it opens the
 * email that arrives after asking, not the newest one there, so an earlier run's used link is never the one opened.
 */
async function signIn(page: Page, address: string) {
  const before = new Set((await emailsTo(address)).map((email) => email.id));
  await askForLink(page, address);
  let arrived: Awaited<ReturnType<typeof emailsTo>>[number] | undefined;
  await expect
    .poll(
      async () => {
        arrived = (await emailsTo(address)).find((email) => !before.has(email.id));
        return arrived !== undefined;
      },
      { message: `a new email to ${address}`, timeout: 30_000 },
    )
    .toBe(true);
  const body = await (arrived?.text() ?? Promise.reject(new Error('no email')));
  await page.goto(signInLink(body, origin));
  // The link leads to `/`, which sends a person with a workspace on to the Inbox.
  await expect(page).toHaveURL(new URL(INBOX, origin).href);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
}

/**
 * The frame's two controls: the switcher and the avatar. The switcher is named by the text it shows, the current
 * workspace's name; its initials badge is decorative (`aria-hidden`), so its text content is "NSNorthwind Social" but
 * its accessible name is exactly the name, which is what the tests check. The avatar is named `{name} ({role})`.
 */
const switcher = (page: Page) => page.locator('[data-slot="workspace-switcher"]');
const avatar = (page: Page) => page.locator('[data-slot="account-menu"]');

/**
 * The switcher shows `name` as the workspace in use: its accessible name is exactly that name (nothing else is read
 * out), and the name itself is visible on the button, not only in hidden text.
 */
async function showsWorkspace(page: Page, name: string) {
  await expect(switcher(page)).toHaveAccessibleName(name);
  await expect(switcher(page).getByText(name, { exact: true })).toBeVisible();
}

/** Waits until the page is drawn, hydrated and has its font. */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Screenshots the page as `workspaces-<state>-<theme>.png`, for Iris: compared with its baseline once one is approved;
 * until then only rendered into the output folder, which CI uploads (`e2e-screenshots`), and annotated.
 */
async function capture(page: Page, testInfo: TestInfo, state: string) {
  const name = `workspaces-${state}-${themeOf(testInfo.project.name)}.png`;
  if (existsSync(testInfo.snapshotPath(name))) {
    await expect(page).toHaveScreenshot(name);
  } else {
    await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
    testInfo.annotations.push({
      type: 'first baseline',
      description: `${name}: rendered for approval (Q11); no baseline to compare with yet.`,
    });
  }
}

/**
 * The switcher's workspace mark, as drawn: its fill and its initials' colour, beside the theme's ink (`foreground`) and
 * paper (`background`) tokens, all as the browser computes them (`rgb(…)`), so they compare whatever the notation.
 */
async function markColours(page: Page) {
  return switcher(page)
    .locator('[data-slot="avatar-fallback"]')
    .evaluate((mark) => {
      const token = (name: string) => {
        const probe = document.createElement('i');
        probe.style.color = `var(${name})`;
        mark.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      };
      const drawn = getComputedStyle(mark);
      return {
        fill: drawn.backgroundColor,
        initials: drawn.color,
        ink: token('--color-foreground'),
        paper: token('--color-background'),
      };
    });
}

async function seriousIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
    }));
}

// ---- seed:dev's people ------------------------------------------------------------------------------------------

test('a seeded Northwind person signs in through Mailpit and lands in Northwind Social; the frame, then sign-out', async ({
  page,
}, testInfo) => {
  // `seed:dev`'s own plan, run as it runs (a second run changes nothing). The light project signs in its Owner and the
  // dark one its Editor, so the two never read the same mailbox at once.
  const seed = devSeed();
  await runSeed(ownerUrl, seed);
  const theme = themeOf(testInfo.project.name);
  const person = seed.people.find((p) => p.role === (theme === 'light' ? 'owner' : 'editor'));
  if (person === undefined) throw new Error('seed:dev has no such person');
  const role = person.role === 'owner' ? 'Owner' : 'Editor';

  await signIn(page, person.email);
  await showsWorkspace(page, seed.workspace.name);
  await expect(avatar(page)).toHaveAccessibleName(`${person.name} (${role})`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Nothing waiting. Even gods take breaks.' }),
  ).toBeVisible();
  await settled(page);

  // The workspace's mark, as the mockup's 03-inbox draws it: a filled dark disc with light initials (Iris F2). The tokens
  // are the ink pair, so it is the same classes in light and dark.
  const mark = await markColours(page);
  expect(mark.fill).toBe(mark.ink);
  expect(mark.initials).toBe(mark.paper);

  // The frame, drawn in the project's theme, for Iris (and, once approved, compared with its baseline).
  await capture(page, testInfo, 'inbox');
  expect(await seriousIssues(page)).toEqual([]);

  // The avatar's menu, open: it names the person with their role, and signs them out.
  await avatar(page).click();
  const menu = page.getByRole('menu', { name: 'Your account' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText(`${person.name} (${role})`)).toBeVisible();
  await capture(page, testInfo, 'account-menu');
  expect(await seriousIssues(page)).toEqual([]);
  await menu.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(new URL('/sign-in', origin).href);
  expect(sessionCookies(await page.context().cookies())).toEqual([]);
  // The Inbox is closed to them now: the proxy sends a visitor with no session to /sign-in.
  await page.goto(INBOX);
  await expect(page).toHaveURL(new URL('/sign-in', origin).href);
});

// ---- A person in two workspaces ---------------------------------------------------------------------------------

/** A query as text, as tests/lib/sign-in.ts writes them: each `${value}` a quoted SQL literal, all this test's own. */
function text(strings: TemplateStringsArray, ...values: string[]): string {
  let query = '';
  strings.forEach((part, i) => {
    query += part;
    const value = values[i];
    if (value !== undefined) query += `'${value.replaceAll("'", "''")}'`;
  });
  return query;
}

/** Removes a run's two workspaces and two people; their memberships and sessions go with them (cascades). */
async function removeRun(workspaces: readonly [Seed, Seed], emails: readonly [string, string]) {
  const [a, b] = workspaces;
  const owner = createDb(ownerUrl);
  try {
    // The owner role isn't bound by row-level security; `forWorkspace` is the one door in, and any id will do.
    const through = owner.forWorkspace({ workspaceId: randomUUIDv7() });
    await through.transaction(async (tx) => {
      await tx.execute(
        text`delete from workspace where slug in (${a.workspace.slug}, ${b.workspace.slug})`,
      );
      await tx.execute(text`delete from "user" where email in (${emails[0]}, ${emails[1]})`);
    });
  } finally {
    await owner.close();
  }
}

test('a person in two workspaces switches between them and sees only the current one’s name and role', async ({
  page,
}) => {
  // This run's own people and workspaces, made with the seeds' code and removed at the end. Mina owns Harbour and is an
  // Editor in Kite, whose Owner is Rafi; "Harbour" comes first by name, so a new session opens there.
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
  await runSeed(ownerUrl, harbour);
  await runSeed(ownerUrl, kite);

  try {
    await signIn(page, mina.email);
    // The first workspace by name, with her role in it, and nothing of the other one on the page.
    await showsWorkspace(page, harbour.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Owner)`);
    await expect(page.getByText(kite.workspace.name)).toHaveCount(0);

    // The switcher lists both, with her role in each.
    await switcher(page).click();
    const menu = page.getByRole('menu', { name: 'Workspaces' });
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
    await expect(menu.getByRole('menuitemradio', { checked: true })).toContainText(
      harbour.workspace.name,
    );
    await menu.getByRole('menuitemradio', { name: new RegExp(`Kite ${tag}`) }).click();

    // Now Kite, as an Editor; Harbour's name is nowhere on the page.
    await showsWorkspace(page, kite.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Editor)`);
    await expect(page.getByText(harbour.workspace.name)).toHaveCount(0);

    // The last one used opens first: a fresh load of the Inbox, and of `/`, opens Kite.
    await page.goto(INBOX);
    await showsWorkspace(page, kite.workspace.name);
    await page.goto('/');
    await expect(page).toHaveURL(new URL(INBOX, origin).href);
    await showsWorkspace(page, kite.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Editor)`);

    // And back.
    await switcher(page).click();
    await page
      .getByRole('menu', { name: 'Workspaces' })
      .getByRole('menuitemradio', { name: new RegExp(`Harbour ${tag}`) })
      .click();
    await showsWorkspace(page, harbour.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Owner)`);
  } finally {
    await removeRun([harbour, kite], [mina.email, rafi.email]);
  }
});

// ---- The frame's states (Iris, round 1) -------------------------------------------------------------------------

/** A server action's request: a POST to the page, with Next.js's `next-action` header. */
const isServerAction = (request: Request) =>
  request.method() === 'POST' && request.headers()['next-action'] !== undefined;
/** The Inbox's own address, where its server actions (the switcher's) are posted. */
const atInbox = (url: URL) => url.pathname === INBOX;

test('the frame’s states: long and Bangla names, the switcher open, switching, a failed switch and a failed sign-out', async ({
  page,
}, testInfo) => {
  // This run's own people and workspaces, removed at the end. Lina (her name in Bangla) owns a workspace whose name is
  // too long for the button, and is an Editor in one named in Bangla, whose Owner is Sumi. The Latin name sorts before
  // the Bengali one, so a new session opens in the long one.
  const run = randomUUID();
  const tag = run.slice(0, 8);
  const lina = { email: `lina-${run}@workspaces.invalid`, name: 'লিনা হক' };
  const sumi = { email: `sumi-${run}@workspaces.invalid`, name: 'Sumi Akter' };
  const long: Seed = {
    workspace: {
      name: `Brightwell Dental and Ironline Studio shared creative workspace ${tag}`,
      slug: `long-${run}`,
    },
    people: [{ ...lina, role: 'owner', platformAdmin: false }],
  };
  const bangla: Seed = {
    workspace: { name: `গল্প ক্যাফে স্টুডিও ${tag}`, slug: `bangla-${run}` },
    people: [
      { ...sumi, role: 'owner', platformAdmin: false },
      { ...lina, role: 'editor', platformAdmin: false },
    ],
  };
  await runSeed(ownerUrl, long);
  await runSeed(ownerUrl, bangla);

  try {
    // A long name: cut with an ellipsis on the button, still its whole name for a screen reader.
    await signIn(page, lina.email);
    await showsWorkspace(page, long.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${lina.name} (Owner)`);
    await settled(page);
    await capture(page, testInfo, 'long-name');
    expect(await seriousIssues(page)).toEqual([]);

    // The switcher, open: both names in full (the long one wraps), the Bangla one marked as Bangla, her role in each.
    await switcher(page).click();
    const menu = page.getByRole('menu', { name: 'Workspaces' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
    await expect(menu.getByText(bangla.workspace.name, { exact: true })).toHaveAttribute(
      'lang',
      'bn',
    );
    await capture(page, testInfo, 'switcher-open');
    expect(await seriousIssues(page)).toEqual([]);

    // Switching: the switcher's server action is held, and the button stays disabled until it answers.
    const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
    const hold = async (route: Route) => {
      if (!isServerAction(route.request())) return route.fallback();
      await held;
      return route.continue();
    };
    await page.route(atInbox, hold);
    await menu.getByRole('menuitemradio', { name: bangla.workspace.name }).click();
    await expect(switcher(page)).toBeDisabled();
    await capture(page, testInfo, 'switching');
    release(undefined);

    // The Bangla name, on the button and marked as Bangla; her role there.
    await showsWorkspace(page, bangla.workspace.name);
    await expect(switcher(page)).toBeEnabled();
    await expect(switcher(page).getByText(bangla.workspace.name, { exact: true })).toHaveAttribute(
      'lang',
      'bn',
    );
    await expect(avatar(page)).toHaveAccessibleName(`${lina.name} (Editor)`);
    await page.unroute(atInbox, hold);
    await settled(page);
    await capture(page, testInfo, 'bangla-name');
    expect(await seriousIssues(page)).toEqual([]);

    // A switch that never reaches the server: the switcher says so beside it, and the page stays where it was.
    const lose = (route: Route) =>
      isServerAction(route.request()) ? route.abort('internetdisconnected') : route.fallback();
    await page.route(atInbox, lose);
    await switcher(page).click();
    await page
      .getByRole('menu', { name: 'Workspaces' })
      .getByRole('menuitemradio', { name: long.workspace.name })
      .click();
    await expect(
      page.getByText('Couldn’t open that workspace. Check your connection and try again.'),
    ).toBeVisible();
    await showsWorkspace(page, bangla.workspace.name);
    await expect(switcher(page)).toBeEnabled();
    await page.unroute(atInbox, lose);
    await capture(page, testInfo, 'switch-error');
    expect(await seriousIssues(page)).toEqual([]);

    // A sign-out that fails: the page says so, and stays.
    await page.route('**/api/auth/sign-out', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await avatar(page).click();
    await page
      .getByRole('menu', { name: 'Your account' })
      .getByRole('menuitem', { name: 'Sign out' })
      .click();
    await expect(
      page.getByText('Couldn’t sign you out. Check your connection and try again.'),
    ).toBeVisible();
    await expect(page).toHaveURL(new URL(INBOX, origin).href);
    await expect(avatar(page)).toBeEnabled();
    await capture(page, testInfo, 'sign-out-error');
    expect(await seriousIssues(page)).toEqual([]);
  } finally {
    await removeRun([long, bangla], [lina.email, sumi.email]);
  }
});

// ---- /app on its way (Iris F4, round 5) -------------------------------------------------------------------------

/** Every `<script>` element in an HTML document, inline or not, with its content. */
const SCRIPTS = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;

/**
 * Loads the Inbox's document as the server sends it, without its scripts, and with the theme's class on <html> (the
 * class is put there by a script too). The browser draws the HTML as it arrives: the skeleton first, and the guarded
 * frame after it in a hidden element, which only React's scripts swap in. With none of them in the page, it stays in
 * the state a person sees while the guard opens the workspace. The page itself still runs script, so the screenshot,
 * the font wait and axe work as on every other page (a context with JavaScript off stalls them).
 */
function withoutScripts(theme: 'light' | 'dark') {
  return async (route: Route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const html = (await response.text())
      .replace(SCRIPTS, '')
      .replace(/<html\b/, theme === 'dark' ? '<html class="dark"' : '<html');
    // The body is new and decoded: the original's length and encoding no longer describe it.
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(
        ([name]) => !['content-length', 'content-encoding', 'transfer-encoding'].includes(name),
      ),
    );
    return route.fulfill({ response, headers, body: html });
  };
}

test('/app on its way: the frame and the Inbox are skeletons until the guard has opened the workspace', async ({
  page,
}, testInfo) => {
  // Each step has its own short timeout, so a stall fails at its cause rather than at the test's end.
  const theme = themeOf(testInfo.project.name);
  await test.step(
    'sign in a seed:dev person',
    async () => {
      // seed:dev's people, as in the first test: its Owner in the light project and its Editor in the dark one.
      const seed = devSeed();
      await runSeed(ownerUrl, seed);
      const person = seed.people.find((p) => p.role === (theme === 'light' ? 'owner' : 'editor'));
      if (person === undefined) throw new Error('seed:dev has no such person');
      await signIn(page, person.email);
    },
    { timeout: 20_000 },
  );

  await test.step(
    'load /app without its scripts',
    async () => {
      await page.route(atInbox, withoutScripts(theme));
      await page.goto(INBOX);
      await expect(page.locator('script')).toHaveCount(0);
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass('dark');
      else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    },
    { timeout: 10_000 },
  );

  await test.step(
    'the skeletons, and nothing of the workspace',
    async () => {
      // The gallery's skeletons where the switcher and the list will be; the page's heading and line as they will be.
      await expect(page.locator('[data-slot="workspace-switcher-skeleton"]')).toBeVisible();
      await expect(page.locator('[data-slot="sidebar-menu-skeleton"]').first()).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Loading workspaces…' })).toHaveCount(
        1,
      );
      await expect(page.getByRole('status').filter({ hasText: 'Loading your Inbox…' })).toHaveCount(
        1,
      );
      // Nothing of the workspace shows before the guard has answered: the real switcher and avatar are still hidden.
      await expect(switcher(page)).toBeHidden();
      await expect(avatar(page)).toBeHidden();
    },
    { timeout: 10_000 },
  );

  await test.step(
    'screenshot',
    async () => {
      await settled(page);
      await capture(page, testInfo, 'loading');
    },
    { timeout: 10_000 },
  );

  await test.step(
    'axe',
    async () => {
      expect(await seriousIssues(page)).toEqual([]);
    },
    { timeout: 10_000 },
  );
});
