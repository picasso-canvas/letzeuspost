/// <reference lib="dom" />
// The Sign-in feature's journey (§19 A task's life, #224): someone with an account signs in with an emailed link.
// It lands as the feature's first task, marked as an expected failure while the feature is unbuilt, so CI stays green;
// the feature's last task (#78) takes the mark off, and the feature is done when the test passes in CI (#156).
//
// It drives the built app in the `journeys` project, with the worker running (CI's `services` job starts both).
// It uses only what the feature's tasks fix: the route `/sign-in` and the proxy's redirect to it (#78); the button's
// words, "Email me a sign-in link" (§23, apps/web/messages/en.json); the sign-in link email, sent through the outbox
// and the worker's `email` job (#77) and read from Mailpit's HTTP API; a session cookie set when the link is opened
// (#77, §13: HttpOnly, SameSite=Lax); and the plain "used or expired link" message (#77, #78). Each later task of the
// feature may change a call below to follow its real API, never weaken an assertion. Where a name isn't fixed yet, the
// comment beside it says what is assumed.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from '../../config/env.ts';
import { createDb } from '../../packages/db/src/index.ts';

// ---- The person -------------------------------------------------------------------------------------------------

/**
 * A person with an account, made before the test the way the Data journey (tests/journeys/data.int.test.ts) makes its
 * rows: by the owner role (the app role can't insert a person, #176), as Better Auth's `user` row with a name and an
 * email and nothing else. Assumptions: the other columns have defaults; the address counts as known to the sign-in
 * link (invite-only, so an unknown address gets no account made); no workspace is needed to land on an app page. The
 * address is this run's own, so runs side by side don't meet. Returns a function that removes the person again (their
 * sessions go with them: Better Auth's session rows cascade from the user).
 */
async function createAccount(email: string, run: string) {
  const owner = createDb(loadEnv('migrate').DATABASE_OWNER_URL);
  // The owner role isn't bound by row-level security, but `forWorkspace` is the one door in; any workspace id will do.
  const through = owner.forWorkspace({ workspaceId: randomUUIDv7() });
  const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await through.transaction((tx) =>
    tx.execute(
      `insert into "user" (name, email) values (${quoted(`Journey ${run}`)}, ${quoted(email)})`,
    ),
  );
  return async () => {
    await through.transaction((tx) =>
      tx.execute(`delete from "user" where email = ${quoted(email)}`),
    );
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
async function emailsTo(address: string) {
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
async function emailsArrived(address: string, count: number) {
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
function signInLink(text: string, origin: string): string {
  const addresses = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const link = addresses
    .map((address) => address.replace(/[.,;]+$/, ''))
    .find((address) => URL.parse(address)?.origin === origin);
  if (link === undefined) throw new Error(`no sign-in link on ${origin} in the email:\n${text}`);
  return link;
}

// ---- The sign-in page -------------------------------------------------------------------------------------------

/**
 * Types an address on `/sign-in` and chooses the button, whose words §23 fixes. Assumption: the field is the page's one
 * text box, named for the email (its label has "email" in it). Returns the page's answer, the words the page shows.
 */
async function askForLink(page: Page, address: string): Promise<string> {
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /email/i }).fill(address);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  // Assumption: the answer is a message that says to check the email (the same words for any address, Q9).
  const answer = page.getByText(/check your email/i);
  await expect(answer).toBeVisible();
  return (await answer.innerText()).trim();
}

/** The cookies a context holds that are a session's: Better Auth's session cookie (assumed: its name has "session"). */
const sessionCookies = (cookies: { name: string }[]) =>
  cookies.filter((cookie) => /session/i.test(cookie.name));

// ---- The journey ------------------------------------------------------------------------------------------------

test.fail(
  'someone with an account signs in with an emailed link',
  async ({ page, context, browser, baseURL }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL ?? '').origin;
    const run = randomUUID();
    const email = `signin-${run}@journey.invalid`;
    const stranger = `stranger-${run}@journey.invalid`;

    // 1. A test account exists.
    const removeAccount = await createAccount(email, run);
    // A person who is signed out: a context of its own, with no cookies from the first one.
    const signedOut = await browser.newContext({ baseURL: origin });
    try {
      // 2. Signed out, opening an app page (the Inbox, `/`) sends the person to `/sign-in`.
      await page.goto('/');
      expect(new URL(page.url()).pathname).toBe('/sign-in');
      expect(sessionCookies(await context.cookies())).toEqual([]);

      // 3. They type their address and choose "Email me a sign-in link"; the page says to check their email.
      const answered = await askForLink(page, email);
      expect(answered).toMatch(/check your email/i);

      // 4. The email arrives in Mailpit, with the sign-in link on the app's own origin.
      const [arrived, ...others] = await emailsArrived(email, 1);
      expect(others).toEqual([]);
      const text = await (arrived?.text() ?? Promise.reject(new Error('no email')));
      const link = signInLink(text, origin);
      expect(new URL(link).pathname).not.toBe('/sign-in');

      // 5. Opening the link signs them in: they land on an app page, not `/sign-in`, and a session cookie is set,
      // HttpOnly and SameSite=Lax (§13). A signed-in person who opens the Inbox stays there.
      const landed = await page.goto(link);
      expect(landed?.status()).toBeLessThan(400);
      expect(new URL(page.url()).pathname).not.toBe('/sign-in');
      const sessions = sessionCookies(await context.cookies());
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
      await page.goto('/');
      expect(new URL(page.url()).pathname).toBe('/');

      // 6. Opening the same link again, signed out, is refused with the page's plain "used or expired link" message,
      // and no session starts.
      const again = await signedOut.newPage();
      await again.goto(link);
      await expect(again.getByText(/used or expired link/i)).toBeVisible();
      expect(sessionCookies(await signedOut.cookies())).toEqual([]);
      await again.goto('/');
      expect(new URL(again.url()).pathname).toBe('/sign-in');

      // 7. An unknown address gets the same "check your email" answer, and no email arrives for it (Q9: nothing tells
      // whether an address has an account). To show that "none" means the worker had its time, a second link for the
      // known address is asked for after it: once that one has arrived, the worker has drained the queue.
      const unknownAnswer = await askForLink(await signedOut.newPage(), stranger);
      expect(unknownAnswer).toBe(answered);
      await askForLink(await signedOut.newPage(), email);
      await emailsArrived(email, 2);
      expect(await emailsTo(stranger)).toEqual([]);
    } finally {
      await signedOut.close();
      await removeAccount();
    }
  },
);
