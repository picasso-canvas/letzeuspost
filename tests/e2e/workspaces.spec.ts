/// <reference lib="dom" />
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from '../../config/env.ts';
import { createDb } from '../../packages/db/src/index.ts';
import { runSeed } from '../../packages/db/src/seed/run.ts';
import { devSeed, type Seed } from '../../packages/db/src/seed/seed.ts';
import { askForLink, emailsTo, sessionCookies, signInLink } from '../lib/sign-in.ts';

// Workspaces in the app (#79), in the `app-light` and `app-dark` projects (1440 px): the people the seeds make sign in
// through the real flow (the link asked for on /sign-in, the email in Mailpit, the link opened) and land in their
// workspace under /app (Q13); a person in two workspaces switches between them and sees only the one they're in; the
// avatar menu signs out. The Inbox's frame is screenshotted in both themes and checked with axe.
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

/** The frame's two controls: the switcher (named by the workspace it shows) and the avatar (named `{name} ({role})`). */
const switcher = (page: Page) => page.locator('[data-slot="workspace-switcher"]');
const avatar = (page: Page) => page.locator('[data-slot="account-menu"]');

/** Waits until the page is drawn, hydrated and has its font. */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
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
  await expect(switcher(page)).toHaveText(seed.workspace.name);
  await expect(avatar(page)).toHaveAccessibleName(`${person.name} (${role})`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Nothing waiting. Even gods take breaks.' }),
  ).toBeVisible();
  await settled(page);

  // The frame, drawn in the project's theme, for Iris (and, once approved, compared with its baseline).
  const name = `workspaces-inbox-${theme}.png`;
  if (existsSync(testInfo.snapshotPath(name))) {
    await expect(page).toHaveScreenshot(name);
  } else {
    await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
    testInfo.annotations.push({
      type: 'first baseline',
      description: 'Rendered for approval (Q11); no baseline to compare with yet.',
    });
  }
  expect(await seriousIssues(page)).toEqual([]);

  // The avatar's menu, open: it names the person with their role, and signs them out.
  await avatar(page).click();
  const menu = page.getByRole('menu', { name: 'Your account' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText(`${person.name} (${role})`)).toBeVisible();
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

  const owner = createDb(ownerUrl);
  try {
    await signIn(page, mina.email);
    // The first workspace by name, with her role in it, and nothing of the other one on the page.
    await expect(switcher(page)).toHaveText(harbour.workspace.name);
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
    await expect(switcher(page)).toHaveText(kite.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Editor)`);
    await expect(page.getByText(harbour.workspace.name)).toHaveCount(0);

    // The last one used opens first: a fresh load of the Inbox, and of `/`, opens Kite.
    await page.goto(INBOX);
    await expect(switcher(page)).toHaveText(kite.workspace.name);
    await page.goto('/');
    await expect(page).toHaveURL(new URL(INBOX, origin).href);
    await expect(switcher(page)).toHaveText(kite.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Editor)`);

    // And back.
    await switcher(page).click();
    await page
      .getByRole('menu', { name: 'Workspaces' })
      .getByRole('menuitemradio', { name: new RegExp(`Harbour ${tag}`) })
      .click();
    await expect(switcher(page)).toHaveText(harbour.workspace.name);
    await expect(avatar(page)).toHaveAccessibleName(`${mina.name} (Owner)`);
  } finally {
    // The owner role isn't bound by row-level security; `forWorkspace` is the one door in, and any id will do. The
    // memberships and sessions go with the workspaces and the people (cascades).
    const through = owner.forWorkspace({ workspaceId: randomUUIDv7() });
    await through.transaction(async (tx) => {
      await tx.execute(
        text`delete from workspace where slug in (${harbour.workspace.slug}, ${kite.workspace.slug})`,
      );
      await tx.execute(text`delete from "user" where email in (${mina.email}, ${rafi.email})`);
    });
    await owner.close();
  }
});
