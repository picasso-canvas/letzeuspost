// Signing in through the real flow, for the tests that need a person who is signed in: an account row, the link asked
// for on `/sign-in`, the email found in Mailpit, the link opened. The Sign-in journey (tests/journeys/sign-in.spec.ts)
// drives the same steps one by one and checks each; the app shell's tests (tests/e2e/home.spec.ts,
// tests/journeys/app-shell.spec.ts) sign in first, because `/` is an app page and the proxy sends a signed-out visitor
// from it to `/sign-in` (#78). Nothing here skips a step of the flow: no cookie is made by hand.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { loadEnv } from '../../config/env.ts';
import { createDb } from '../../packages/db/src/index.ts';

// ---- The person -------------------------------------------------------------------------------------------------

/**
 * A query as text: each `${value}` becomes a quoted SQL literal, as in the Data journey (tests/journeys/data.int.test.ts).
 * Better Auth's `user` table has no export the root may import (#176), so its rows go in as text. Every value is one this
 * test made.
 */
function text(strings: TemplateStringsArray, ...values: string[]): string {
  let query = '';
  strings.forEach((part, i) => {
    query += part;
    const value = values[i];
    if (value !== undefined) query += `'${value.replaceAll("'", "''")}'`;
  });
  return query;
}

/**
 * A person with an account, made before the test the way the Data journey (tests/journeys/data.int.test.ts) makes its
 * rows: by the owner role (the app role can't insert a person, #176), as Better Auth's `user` row with a name and an
 * email and nothing else. Assumptions: the other columns have defaults; the address counts as known to the sign-in
 * link (invite-only, so an unknown address gets no account made); no workspace is needed to land on an app page. The
 * address is this run's own, so runs side by side don't meet. Returns a function that removes the person again (their
 * sessions go with them: Better Auth's session rows cascade from the user).
 */
export async function createAccount(email: string, run: string) {
  const owner = createDb(loadEnv('migrate').DATABASE_OWNER_URL);
  // The owner role isn't bound by row-level security, but `forWorkspace` is the one door in; any workspace id will do.
  const through = owner.forWorkspace({ workspaceId: randomUUIDv7() });
  await through.transaction((tx) =>
    tx.execute(text`insert into "user" (name, email) values (${`Journey ${run}`}, ${email})`),
  );
  return async () => {
    await through.transaction((tx) => tx.execute(text`delete from "user" where email = ${email}`));
    await owner.close();
  };
}

// ---- Mailpit ----------------------------------------------------------------------------------------------------

interface MailpitSearch {
  messages: { ID: string; To: { Address: string }[] }[];
}

/**
 * Mailpit's HTTP API: on LZP_MAILPIT_PORT (8025) of the SMTP host (docker/compose.yml), as in the `services` job and
 * the Data journey. The emails sent to one address, newest first.
 */
export async function emailsTo(address: string) {
  const host = URL.parse(loadEnv('worker').SMTP_URL)?.hostname ?? '127.0.0.1';
  const api = `http://${host}:${process.env['LZP_MAILPIT_PORT'] ?? '8025'}/api/v1`;
  const found = await fetch(
    `${api}/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=50`,
  );
  expect(found.ok).toBe(true);
  const { messages } = (await found.json()) as MailpitSearch;
  return messages
    .filter((message) => message.To.some((addressee) => addressee.Address === address))
    .map((message) => ({
      id: message.ID,
      text: async () => {
        const read = await fetch(`${api}/message/${message.ID}`);
        expect(read.ok).toBe(true);
        return ((await read.json()) as { Text: string }).Text;
      },
    }));
}

/** The address's emails once `count` of them have arrived (the worker sends them; nothing in a request waits). */
export async function emailsArrived(address: string, count: number) {
  await expect
    .poll(async () => (await emailsTo(address)).length, {
      message: `${String(count)} email(s) to ${address}`,
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(count);
  return emailsTo(address);
}

/**
 * The sign-in link in an email's plain-text version. Assumption: it is the first http(s) address in the text that is
 * on the app's own origin (APP_URL, which is the project's baseURL); a trailing full stop or bracket isn't part of it.
 */
export function signInLink(body: string, origin: string): string {
  const addresses = body.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const link = addresses
    .map((address) => address.replace(/[.,;]+$/, ''))
    .find((address) => URL.parse(address)?.origin === origin);
  if (link === undefined) throw new Error(`no sign-in link on ${origin} in the email:\n${body}`);
  return link;
}

// ---- The sign-in page -------------------------------------------------------------------------------------------

/**
 * Types an address on `/sign-in` and chooses the button, whose words §23 fixes. The field is the page's one text box,
 * named for the email ("Your email"). Returns the page's answer, the words the page shows.
 */
export async function askForLink(page: Page, address: string): Promise<string> {
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /email/i }).fill(address);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  // The answer is the heading "Check your email", the same words for any address (Q9).
  const answer = page.getByText(/check your email/i);
  await expect(answer).toBeVisible();
  return (await answer.innerText()).trim();
}

/**
 * The cookies a context holds that are a session's: Better Auth's session token cookie, `better-auth.session_token`
 * (packages/auth, #77), with `__Secure-` in front where the app is HTTPS. Its cache cookie (`session_data`) holds no
 * session and isn't counted.
 */
export const sessionCookies = <Cookie extends { name: string }>(cookies: Cookie[]) =>
  cookies.filter((cookie) => /^(__Secure-)?better-auth\.session_token$/.test(cookie.name));

/**
 * The whole flow for an address that has an account: ask for the link on the page, find the email in Mailpit, open the
 * link in that page. The page ends signed in, on the app page the link leads to.
 */
export async function signInWithLink(page: Page, address: string, origin: string) {
  await askForLink(page, address);
  const [arrived] = await emailsArrived(address, 1);
  const body = await (arrived?.text() ?? Promise.reject(new Error('no email')));
  const response = await page.goto(signInLink(body, origin));
  expect(response?.status()).toBeLessThan(400);
  expect(new URL(page.url()).pathname).not.toBe('/sign-in');
}

// ---- A signed-in page for a test --------------------------------------------------------------------------------

/**
 * `test` with a `signedInPage`: a page in a context of its own that holds a session. The sign-in runs once for each
 * worker (a worker is one project's run of one or more files), not for each test: sign-in requests are limited to 20
 * an hour for each IP (config/sign-in.ts), and every test here comes from one. The account is the worker's own, and is
 * removed when the worker is done.
 */
export const test = base.extend<
  { signedInPage: Page },
  { signedInState: Awaited<ReturnType<BrowserContext['storageState']>> }
>({
  signedInState: [
    async ({ browser }, use) => {
      const origin = new URL(loadEnv('worker').APP_URL).origin;
      const run = randomUUID();
      const email = `shell-${run}@journey.invalid`;
      const removeAccount = await createAccount(email, run);
      const context = await browser.newContext({ baseURL: origin });
      try {
        await signInWithLink(await context.newPage(), email, origin);
        expect(sessionCookies(await context.cookies())).toHaveLength(1);
        await use(await context.storageState());
      } finally {
        await context.close();
        await removeAccount();
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  signedInPage: async ({ browser, signedInState, baseURL }, use) => {
    const context = await browser.newContext({ baseURL, storageState: signedInState });
    await use(await context.newPage());
    await context.close();
  },
});
