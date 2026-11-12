import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The sign-in link email (#77, Athena's decision 7), for Iris: its HTML version drawn as a mail client would, at the
// email's width and in the light theme, and its plain-text version read. It runs in the `app-light` and `app-dark`
// projects; an email doesn't follow the browser's theme, so both draw it light.
//
// Baselines (Q11), as in home.spec.ts: CI renders the screenshot and uploads it (`e2e-screenshots`); Iris and Zeus
// approve the first one; then Athena commits it to tests/visual/approved/. A builder never writes that folder, so until
// a baseline exists the screenshot is only taken (and annotated).

const appUrl = 'http://localhost:3000';
const link = `${appUrl}/api/auth/magic-link/verify?token=${'AbCdEfGh'.repeat(4)}&callbackURL=%2Fapp`;

/** The email's width: its card is at most 520 px wide (packages/email's Layout), in a 600 px column. */
const EMAIL_WIDTH = 600;

interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

type Render = (name: string, data: unknown, context: { appUrl: string }) => Promise<RenderedEmail>;

/** @lzp/email's built output, as the worker renders it (Q8); the worker's start builds it before the tests run. */
const built = new URL('../../packages/email/dist/index.js', import.meta.url);

let email: RenderedEmail;

test.beforeAll(async () => {
  if (!existsSync(built)) {
    execFileSync('pnpm', ['--filter', '@lzp/email', 'build'], { stdio: 'ignore' });
  }
  const { renderTemplate } = (await import(built.href)) as { renderTemplate: Render };
  email = await renderTemplate('sign-in-link', { url: link }, { appUrl });
});

test('the plain-text version holds the link and says it lasts 10 minutes', () => {
  expect(email.subject).toBe('Your LetZeusPost sign-in link');
  expect(email.text).toContain(link);
  expect(email.text).toContain('The link works once, for 10 minutes.');
});

test('screenshot: the sign-in email, light', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: EMAIL_WIDTH, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setContent(email.html, { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Sign in to LetZeusPost' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', link);

  const name = 'sign-in-email.png';
  if (existsSync(testInfo.snapshotPath(name))) {
    await expect(page).toHaveScreenshot(name, { fullPage: true });
  } else {
    await page.screenshot({
      path: testInfo.outputPath(name),
      fullPage: true,
      animations: 'disabled',
    });
    testInfo.annotations.push({
      type: 'first baseline',
      description: 'Rendered for approval (Q11); no baseline to compare with yet.',
    });
  }
});
