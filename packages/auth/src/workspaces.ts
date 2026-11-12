// Workspaces and members (#77, decision (a) of 2026-11-10): packages/auth makes them itself, never Better Auth, whose
// adapter doesn't reach `workspace`, `member` or `invitation` (it isn't given them, and lzp_auth holds no grant on
// them). No row-level-security policy is widened for this:
// - a workspace and its Owner are written in one unit of work of `db.forWorkspace`, set to an id the app makes (a
//   UUIDv7), since §13's policy lets a workspace row be written only with its own id set;
// - a person's workspaces are read through `forUser`, under Q5's second policy, which shows them their own memberships;
// - the session's active workspace is set through Better Auth's session (its additional field), after `forUser` has
//   found the membership.
import { randomUUIDv7 } from 'node:crypto';
import { member, roles, workspace, type Db } from '@lzp/db';
import type { AuthDb, UserCtx } from '@lzp/db/auth';

export interface NewWorkspace {
  readonly name: string;
  /** Lowercase letters, digits and hyphens: it may appear in addresses. */
  readonly slug: string;
}

export interface WorkspaceOfMember {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: (typeof roles)[number];
}

const MAX_NAME = 200;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 63;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Creates a workspace with `owner` its Owner, in one unit of work. Returns the id the app made for it. */
export async function createWorkspace(
  db: Pick<Db, 'forWorkspace'>,
  owner: UserCtx,
  input: NewWorkspace,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (name === '' || name.length > MAX_NAME) {
    throw new Error(
      `createWorkspace: a workspace needs a name of 1 to ${String(MAX_NAME)} characters`,
    );
  }
  if (input.slug.length > MAX_SLUG || !SLUG.test(input.slug)) {
    throw new Error('createWorkspace: a workspace slug is lowercase letters, digits and hyphens');
  }
  const id = randomUUIDv7();
  await db.forWorkspace({ workspaceId: id }).transaction(async (tx) => {
    await tx.insert(workspace).values({ id, name, slug: input.slug });
    await tx.insert(member).values({ workspaceId: id, userId: owner.userId, role: 'owner' });
  });
  return { id };
}

/** The workspaces `person` is a member of, with their role in each, by name. */
export function listWorkspaces(
  authDb: Pick<AuthDb, 'forUser'>,
  person: UserCtx,
): Promise<WorkspaceOfMember[]> {
  return authDb.forUser(person).transaction(async (tx) => {
    const memberships = await tx.query.member.findMany({
      where: (m, { eq }) => eq(m.userId, person.userId),
      columns: { workspaceId: true, role: true },
    });
    if (memberships.length === 0) return [];
    const roleIn = new Map(memberships.map((m) => [m.workspaceId, m.role]));
    const spaces = await tx.query.workspace.findMany({
      where: (w, { inArray }) => inArray(w.id, [...roleIn.keys()]),
      columns: { id: true, name: true, slug: true },
      orderBy: (w, { asc }) => [asc(w.name), asc(w.id)],
    });
    return spaces.flatMap((space) => {
      const role = roleIn.get(space.id);
      return role === undefined ? [] : [{ ...space, role }];
    });
  });
}

/** Whether `person` is a member of `workspaceId`, read through `forUser`. */
export async function isMember(
  authDb: Pick<AuthDb, 'forUser'>,
  person: UserCtx,
  workspaceId: string,
): Promise<boolean> {
  if (!UUID.test(workspaceId)) return false;
  const found = await authDb.forUser(person).transaction((tx) =>
    tx.query.member.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, person.userId), eq(m.workspaceId, workspaceId)),
      columns: { id: true },
    }),
  );
  return found !== undefined;
}
