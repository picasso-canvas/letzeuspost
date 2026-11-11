/// <reference lib="dom" />
// The App shell feature's journey (§19 A task's life, #207): someone opens the app and gets a safe, on-brand page.
// It lands as the feature's last task (#205, #75, #76), after the code it drives, so it is a plain `test`, with no
// `test.fail()` mark: it passes the first time, and the feature is done when it passes in CI (#156).
//
// It drives the built app in the `journeys` project (the browser asks for light; step 2 asks a second page for dark).
// It uses only what the feature's tasks fix: the routes `/` and `/api/health`; the `Content-Security-Policy` header with
// a per-request nonce in its `script-src` (§13 Security summary, #76); the words in apps/web/messages/en.json; and the
// token `--color-background`, light and dark (#74). Where a name isn't fixed, a comment says what the test assumes.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

// Assumption: messages/en.json keeps `app.name` (the page title) and, under `home`, the `heading`, `body` and
// `swatchesLabel` the placeholder shows. Read as data from the file the app reads, so a reworded line needs no edit here.
interface Messages {
  app: { name: string };
  home: { heading: string; body: string; swatchesLabel: string };
}
const messages = JSON.parse(
  readFileSync(new URL('../../apps/web/messages/en.json', import.meta.url), 'utf8'),
) as Messages;

/** The nonce in the `script-src` of a policy. It fails when there is no policy or the directive has no nonce. */
function scriptNonce(policy: string | undefined): string {
  const scriptSrc = /(?:^|;)\s*script-src\s+([^;]*)/.exec(policy ?? '')?.[1];
  const nonce = /'nonce-([^']+)'/.exec(scriptSrc ?? '')?.[1];
  if (nonce === undefined) throw new Error(`no nonce in the script-src of: ${policy ?? '(none)'}`);
  return nonce;
}

const policyOf = (response: APIResponse) => response.headers()['content-security-policy'];

/** The colour the browser paints for a token, read through the page's own CSS (`--color-background` is the token). */
const paintedToken = (page: Page) =>
  page.evaluate(() => {
    // Assumption: the body takes its background from `--color-background` (the base layer of packages/ui, #74).
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--color-background)';
    document.body.append(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { token, body: getComputedStyle(document.body).backgroundColor };
  });

async function openHome(page: Page) {
  const response = await page.goto('/');
  if (response === null) throw new Error('no response for /');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  return response;
}

async function seriousAxeIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
    }));
}

test('someone opens the app and gets a safe, on-brand page', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // 1. `/` answers 200 and shows the placeholder, its words from messages/en.json.
  const home = await openHome(page);
  expect(home.status()).toBe(200);
  await expect(page).toHaveTitle(messages.app.name);
  await expect(page.getByRole('heading', { level: 1, name: messages.home.heading })).toBeVisible();
  await expect(page.getByText(messages.home.body, { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: messages.home.swatchesLabel })).toBeVisible();

  // 2. The page uses the tokens: the body is painted with `--color-background`, which changes when the browser asks for
  // dark. The second page is in the same context, so it also proves the choice is the page's, not stored.
  const light = await paintedToken(page);
  expect(light.body).toBe(light.token);
  const dark = await context.newPage();
  await dark.emulateMedia({ colorScheme: 'dark' });
  await openHome(dark);
  const darkPainted = await paintedToken(dark);
  expect(darkPainted.body).toBe(darkPainted.token);
  expect(darkPainted.token).not.toBe(light.token);

  // 3. Every response carries a policy whose `script-src` has a nonce, and two requests get different ones.
  const nonce = scriptNonce(home.headers()['content-security-policy']);
  const again = await request.get('/');
  expect(again.status()).toBe(200);
  const againNonce = scriptNonce(policyOf(again));
  expect(againNonce).not.toBe(nonce);
  const darkNonce = scriptNonce((await dark.goto('/'))?.headers()['content-security-policy']);
  expect(darkNonce).not.toBe(nonce);
  // The API's responses carry it too ("every response").
  const health = await request.get('/api/health');
  expect(scriptNonce(policyOf(health))).not.toBe(nonce);
  // Every `<script>` the browser built carries this request's nonce and loads from the app's own origin.
  const scripts = await page.evaluate(() =>
    [...document.scripts]
      .filter((script) => ['', 'text/javascript', 'module'].includes(script.type)) // not data blocks
      .map((script) => ({ nonce: script.nonce, src: script.src })),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) {
    expect(script.nonce, script.src || 'inline script').toBe(nonce);
    if (script.src !== '') expect(new URL(script.src).origin).toBe(new URL(baseURL ?? '').origin);
  }
  // The same in the HTML the server sent, before the browser touched it (the second request's, with its own nonce):
  // no script tag without the nonce.
  const tags = (await again.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag).toContain(`nonce="${againNonce}"`);

  // 4. A first visit sets no cookie: the only essential ones arrive with sign-in (#77, §16).
  const sent = await home.headersArray();
  expect(sent.filter((h) => h.name.toLowerCase() === 'set-cookie')).toEqual([]);
  expect(await context.cookies()).toEqual([]);

  // 5. `/api/health` answers 200 while the database is up (CI starts Postgres), and the body is the status only.
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });

  // 6. axe finds no serious or critical issue, in light and dark.
  expect(await seriousAxeIssues(page)).toEqual([]);
  expect(await seriousAxeIssues(dark)).toEqual([]);
});
