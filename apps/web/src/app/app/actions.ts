'use server';

// The switcher's server action (§15 Workspaces, #79). The id is the browser's, so it is checked, never trusted: the guard
// makes it the session's workspace only if the session is real and the person is a member of it. Nothing else changes.
import { guard } from '@lzp/auth';
import { headers } from 'next/headers';
import { z } from 'zod';

const WorkspaceId = z.uuid();

/** What the switcher hears back: done, or refused (no session, not a member, or not a workspace id at all). */
export type SwitchResult = { ok: true } | { ok: false };

export async function switchWorkspace(workspaceId: unknown): Promise<SwitchResult> {
  const id = WorkspaceId.safeParse(workspaceId);
  // The guard runs first, whatever was sent: the session, then the membership. What isn't a workspace id goes in as
  // '', which no membership matches.
  const switched = await guard().switchTo(await headers(), id.success ? id.data : '');
  return switched.ok ? { ok: true } : { ok: false };
}
