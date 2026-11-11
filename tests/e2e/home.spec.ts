/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The placeholder page of the web app (#76), in the `app-light` and `app-dark` projects (1440 px; the browser asks for
// the project's colour scheme). It checks what a unit test can't: that the built app really draws in both themes, that
// Next.js stamps its own scripts with the request's nonce, and that the policy stops nothing the page needs.
//
// Baselines (Q11), as in the gallery's visual test: CI renders the screenshot and uploads it (`e2e-screenshots`); Iris
// and Zeus approve the first ones; then Athena commits them to tests/visual/approved/. A builder never writes that
// folder, so until a baseline exists the screenshot is only taken (and annotated).

/** The tokens the page uses, from DESIGN.md (`--color-faint`, `--tracking-eyebrow`), as the browser reports them. */
const FAINT = { light: 'rgb(111, 106, 98)', dark: 'rgb(140, 135, 126)' } as const;
const EYEBROW_TRACKING = '0.66px'; // 0.06em of 11px

type Theme = keyof typeof FAINT;
const themeOf = (projectName: string): Theme => (projectName === 'app-dark' ? 'dark' : 'light');

interface Watch {
  violations: () => Promise<string[]>;
  consoleErrors: string[];
  requests: string[];
}

/** Starts listening before the page loads: CSP violations (the page's own events), CSP console errors, requests. */
async function watch(page: Page): Promise<Watch> {
  await page.addInitScript(() => {
    const found: string[] = [];
    Object.assign(window, { lzpCspViolations: found });
    document.addEventListener('securitypolicyviolation', (event) => {
      found.push(`${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  const consoleErrors: string[] = [];
  const requests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('request', (request) => {
    requests.push(request.url());
  });
  return {
    violations: () =>
      page.evaluate(() => (window as unknown as { lzpCspViolations: string[] }).lzpCspViolations),
    consoleErrors,
    requests,
  };
}

/** Opens the page and waits until it is drawn, hydrated and has its font. */
async function openHome(page: Page) {
  const response = await page.goto('/');
  if (response === null) throw new Error('no response for /');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  return response;
}

function nonceIn(policy: string | undefined): string {
  const match = /script-src [^;]*'nonce-([^']+)'/.exec(policy ?? '');
  if (match?.[1] === undefined) throw new Error(`no script nonce in the policy: ${policy ?? ''}`);
  return match[1];
}

test('draws in the theme the browser asks for', async ({ page }, testInfo) => {
  await openHome(page);
  const theme = themeOf(testInfo.project.name);
  // The dark project must really draw dark, or the screenshot and axe would both be of the light theme.
  const drawn = await page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    background: getComputedStyle(document.body).backgroundColor,
  }));
  expect(drawn.dark).toBe(theme === 'dark');
  // The class is not enough: the tokens behind it must really be the dark or the light ones.
  const [red = '255'] = /\d+/.exec(drawn.background) ?? [];
  expect(Number(red) < 128).toBe(theme === 'dark');
});

test('screenshot: placeholder page', async ({ page }, testInfo) => {
  await openHome(page);
  const theme = themeOf(testInfo.project.name);
  const name = `home-${theme}.png`;
  if (existsSync(testInfo.snapshotPath(name))) {
    await expect(page).toHaveScreenshot(name);
  } else {
    await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
    testInfo.annotations.push({
      type: 'first baseline',
      description: 'Rendered for approval (Q11); no baseline to compare with yet.',
    });
  }
});

test('axe: no serious or critical issue', async ({ page }) => {
  await openHome(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking.map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
    })),
  ).toEqual([]);
});

test('the eyebrow uses the faint colour and the eyebrow tracking from DESIGN.md', async ({
  page,
}, testInfo) => {
  await openHome(page);
  const eyebrow = await page
    .locator('main section p')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, tracking: style.letterSpacing, transform: style.textTransform };
    });
  expect(eyebrow).toEqual({
    color: FAINT[themeOf(testInfo.project.name)],
    tracking: EYEBROW_TRACKING,
    transform: 'uppercase',
  });
});

test('the policy lets the page run and look as built: nothing is blocked', async ({ page }) => {
  const seen = await watch(page);
  const response = await openHome(page);
  const nonce = nonceIn(response.headers()['content-security-policy']);

  // Every script on the page carries this request's nonce: Next.js's own, and ours.
  const scripts = await page.evaluate(() =>
    [...document.scripts]
      .filter((script) => ['', 'text/javascript', 'module'].includes(script.type))
      .map((script) => ({ nonce: script.nonce, src: script.src })),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) expect(script.nonce, script.src || 'inline script').toBe(nonce);

  // Nothing was blocked, in the page's own events or in the console (Next.js's styles included).
  expect(await seen.violations()).toEqual([]);
  expect(seen.consoleErrors.filter((text) => /content security policy/i.test(text))).toEqual([]);
});

test('no third-party request and no cookie (§16: essential cookies only)', async ({
  page,
  context,
}) => {
  const seen = await watch(page);
  await openHome(page);
  const origin = new URL(page.url()).origin;
  const foreign = seen.requests.filter(
    (url) => !url.startsWith(origin) && !url.startsWith('data:'),
  );
  expect(foreign).toEqual([]);
  // The placeholder has no session: no cookie of any kind is set.
  expect(await context.cookies()).toEqual([]);
});

test('every response carries a new nonce', async ({ page }) => {
  const first = nonceIn((await page.goto('/'))?.headers()['content-security-policy']);
  const second = nonceIn((await page.goto('/'))?.headers()['content-security-policy']);
  expect(first).not.toBe(second);
  const api = await page.request.get('/api/health', { failOnStatusCode: false });
  expect(api.headers()['content-security-policy']).toContain("script-src 'self' 'nonce-");
});
