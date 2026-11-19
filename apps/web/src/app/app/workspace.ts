// The signed-in pages' guard (§13 The app's API, #79): packages/auth's `guard().open`, once per request. The session
// comes from the request's cookie and the workspace from the session, never from the URL or a header. The layout and
// the page of /app each call it; React's `cache` makes that one database round per request, not two, and lives only as
// long as the request (it is not Next.js's shared cache, which §13 keeps workspace data out of).
import { guard, type Allowed, type Guarded } from '@lzp/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

/** Where a refused page sends the person: fixed paths, never taken from the request. */
export const SIGN_IN = '/sign-in';
/** `/` keeps the placeholder for a person with no workspace yet, and sends one with a workspace here. */
export const NO_WORKSPACE = '/';
/** The Inbox, the signed-in home (Q13: signed-in pages live under /app). */
export const INBOX = '/app';

/** The workspace this request opens in, or why it can't: the guard's answer, asked once per request. */
export const openWorkspace = cache(async (): Promise<Guarded> => {
  // The request first: outside one (a unit test drawing a page) this throws before any database is opened.
  const request = await headers();
  return guard().open(request);
});

/**
 * The guard for a page under /app: the person, the workspace and their role in it. A request with no session goes to
 * /sign-in; a person with no workspace (or none they still belong to) goes to `/`, which shows the placeholder and never
 * comes back here, so no redirect loops.
 */
export async function inWorkspace(): Promise<Allowed> {
  const opened = await openWorkspace();
  if (opened.ok) return opened;
  redirect(opened.refused === 'no-session' ? SIGN_IN : NO_WORKSPACE);
}
