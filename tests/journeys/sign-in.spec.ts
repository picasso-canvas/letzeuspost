/// <reference lib="dom" />
// The Sign-in feature's journey (§19 A task's life, #224): someone with an account signs in with an emailed link.
// It landed as the feature's first task, marked as an expected failure while the feature was unbuilt; the feature's
// last task (#78) took the mark off, and the feature is done when the test passes in CI (#156).
//
// It drives the built app in the `journeys` project, with the worker running (CI's `services` job starts both).
// It uses only what the feature's tasks fix: the route `/sign-in` and the proxy's redirect to it (#78); the button's
// words, "Email me a sign-in link" (§23, apps/web/messages/en.json); the sign-in link email, sent through the outbox
// and the worker's `email` job (#77) and read from Mailpit's HTTP API; Better Auth's session token cookie, set when the
// link is opened (#77, §13: HttpOnly, SameSite=Lax); and the plain "used or expired link" message (#77, #78). Each later
// task of the feature may change a call below to follow its real API, never weaken an assertion. Where a name isn't
// fixed, the comment beside it says what is assumed.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  askForLink,
  createAccount,
  emailsArrived,
  emailsTo,
  sessionCookies,
  signInLink,
} from '../lib/sign-in.ts';

// ---- The journey ------------------------------------------------------------------------------------------------

const run = randomUUID();
const email = `signin-${run}@journey.invalid`;
const stranger = `stranger-${run}@journey.invalid`;
let removeAccount: (() => Promise<void>) | undefined;

// Step 1 is not the feature, so it sits in a hook: if the account or Mailpit is broken, the hook fails and says so,
// instead of the journey failing at a step that has nothing to do with it.
test.beforeAll(async () => {
  // 1. A test account exists, and Mailpit answers.
  removeAccount = await createAccount(email, run);
  expect(await emailsTo(email)).toEqual([]);
});

test.afterAll(async () => {
  await removeAccount?.();
});

test('someone with an account signs in with an emailed link', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? '').origin;
  // A person who is signed out: a context of its own, with no cookies from the first one.
  const signedOut = await browser.newContext({ baseURL: origin });
  try {
    // 2. Signed out, opening an app page (the Inbox, `/`) sends the person to `/sign-in`.
    await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    expect(sessionCookies(await context.cookies())).toEqual([]);

    // 3. They type their address and choose "Email me a sign-in link"; the page says to check their email.
    const answered = await askForLink(page, email);

    // 4. The email arrives in Mailpit, with the sign-in link on the app's own origin.
    const [arrived, ...others] = await emailsArrived(email, 1);
    expect(others).toEqual([]);
    const body = await (arrived?.text() ?? Promise.reject(new Error('no email')));
    const link = signInLink(body, origin);
    expect(new URL(link).pathname).not.toBe('/sign-in');

    // 5. Opening the link signs them in: they land on an app page, not `/sign-in`, and the session token cookie is
    // set, HttpOnly and SameSite=Lax (§13). A signed-in person who opens the Inbox stays there.
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
  }
});
