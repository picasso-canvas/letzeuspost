// The guard (§13 The app's API, #79): "Every handler starts with the same guard: session, workspace, permission."
// Every server action, route handler and signed-in page calls it first, and does nothing when it refuses.
//
// 1. The session, from the request's cookie, checked by Better Auth against the session table.
// 2. The active workspace: the session's own (`activeWorkspaceId`), never one the request names. Only `switchTo` and
//    `open` set it, and only after the person's membership is found (`setActiveWorkspace`, packages/auth's server).
// 3. The person's role in it, from their membership, read through `forUser` (a person sees only their own).
// 4. §15's matrix (#66's `can`), for the action the handler is about to do.
//
// Steps run in that order, and each refusal stops the rest: a request with no session reaches no membership.
import { can, type Action } from '@lzp/core';
import type { UserCtx } from '@lzp/db/auth';
import type { SessionRef } from '../server.ts';
import type { WorkspaceOfMember } from '../workspaces.ts';

/** A session as Better Auth's `getSession` gives it, with the active workspace the session holds. */
export interface GuardSession {
  readonly session: SessionRef & { readonly activeWorkspaceId?: string | null | undefined };
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

/** What the guard reads and writes, as packages/auth's server gives them (`authServer()`). */
export interface GuardDeps {
  getSession: (headers: Headers) => Promise<GuardSession | null>;
  listWorkspaces: (person: UserCtx) => Promise<readonly WorkspaceOfMember[]>;
  setActiveWorkspace: (session: SessionRef, workspaceId: string) => Promise<boolean>;
}

/**
 * Why a request was refused. `no-session`: none, or not a real one. `no-workspace`: the session has no workspace
 * (or the person belongs to none). `not-a-member`: not, or no longer, a member of it. `not-allowed`: their role may not.
 */
export type Refusal = 'no-session' | 'no-workspace' | 'not-a-member' | 'not-allowed';

export interface Refused {
  readonly ok: false;
  readonly refused: Refusal;
}

/** Let through: who, on which session, in which workspace with which role, and every workspace they belong to. */
export interface Allowed {
  readonly ok: true;
  readonly person: { readonly userId: string; readonly name: string; readonly email: string };
  readonly session: SessionRef;
  readonly workspace: WorkspaceOfMember;
  /** For the switcher: the person's workspaces with their role in each, sorted by name. */
  readonly workspaces: readonly WorkspaceOfMember[];
}

export type Guarded = Allowed | Refused;

const refuse = (refused: Refusal): Refused => ({ ok: false, refused });

export function createGuard(deps: GuardDeps) {
  /** Steps 3 and 4 for a workspace the session holds: the person's role in it, then the matrix. */
  function allow(
    found: GuardSession,
    workspaceId: string,
    workspaces: readonly WorkspaceOfMember[],
    action: Action,
  ): Guarded {
    const workspace = workspaces.find((each) => each.id === workspaceId);
    if (workspace === undefined) return refuse('not-a-member');
    // `brandId` null: no handler is on one brand yet; members work on all brands at launch (§15).
    if (!can({ role: workspace.role, action, workspaceId: workspace.id, brandId: null })) {
      return refuse('not-allowed');
    }
    const { user, session } = found;
    return {
      ok: true,
      person: { userId: user.id, name: user.name, email: user.email },
      session: { token: session.token, userId: session.userId },
      workspace,
      workspaces,
    };
  }

  return {
    /** The guard for a server action or route handler that does `action` in the session's workspace. */
    async check(headers: Headers, action: Action): Promise<Guarded> {
      const found = await deps.getSession(headers);
      if (found === null) return refuse('no-session');
      const workspaceId = found.session.activeWorkspaceId;
      if (workspaceId === undefined || workspaceId === null) return refuse('no-workspace');
      const workspaces = await deps.listWorkspaces({ userId: found.session.userId });
      return allow(found, workspaceId, workspaces, action);
    },

    /**
     * The guard for a signed-in page: the workspace it opens in. That is the session's, the last one the person used
     * on it (§15), while they still belong to it; on a new session, or once they've left it, it's the first of their
     * workspaces by name, which is kept on the session from then on. Then the role, and `see-workspace`.
     */
    async open(headers: Headers): Promise<Guarded> {
      const found = await deps.getSession(headers);
      if (found === null) return refuse('no-session');
      const workspaces = await deps.listWorkspaces({ userId: found.session.userId });
      const active = found.session.activeWorkspaceId;
      if (workspaces.some((each) => each.id === active) && typeof active === 'string') {
        return allow(found, active, workspaces, 'see-workspace');
      }
      const [first] = workspaces;
      if (first === undefined) return refuse('no-workspace');
      if (!(await deps.setActiveWorkspace(found.session, first.id))) return refuse('not-a-member');
      return allow(found, first.id, workspaces, 'see-workspace');
    },

    /**
     * The switcher's choice (§15): makes `workspaceId` the session's workspace if the person belongs to it, and refuses
     * it otherwise, leaving the session as it was. The id is the request's, so it is only ever checked, never trusted.
     */
    async switchTo(headers: Headers, workspaceId: string): Promise<{ ok: true } | Refused> {
      const found = await deps.getSession(headers);
      if (found === null) return refuse('no-session');
      const switched = await deps.setActiveWorkspace(found.session, workspaceId);
      return switched ? { ok: true } : refuse('not-a-member');
    },
  };
}

export type Guard = ReturnType<typeof createGuard>;
