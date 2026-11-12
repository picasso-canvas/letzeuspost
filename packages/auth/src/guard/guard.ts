import type { Action } from '@lzp/core';
import type { UserCtx } from '@lzp/db/auth';
import type { SessionRef } from '../server.ts';
import type { WorkspaceOfMember } from '../workspaces.ts';

export interface GuardSession {
  readonly session: SessionRef & { readonly activeWorkspaceId?: string | null | undefined };
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

export interface GuardDeps {
  getSession: (headers: Headers) => Promise<GuardSession | null>;
  listWorkspaces: (person: UserCtx) => Promise<WorkspaceOfMember[]>;
  setActiveWorkspace: (session: SessionRef, workspaceId: string) => Promise<boolean>;
}

export type Refusal = 'no-session' | 'no-workspace' | 'not-a-member' | 'not-allowed';

export interface Allowed {
  readonly ok: true;
  readonly person: { readonly userId: string; readonly name: string; readonly email: string };
  readonly session: SessionRef;
  readonly workspace: WorkspaceOfMember;
  readonly workspaces: readonly WorkspaceOfMember[];
}

export type Guarded = Allowed | { readonly ok: false; readonly refused: Refusal };

export function createGuard(deps: GuardDeps) {
  void deps;
  const refuse = (): Promise<Guarded> => Promise.resolve({ ok: false, refused: 'no-session' });
  return {
    check: (headers: Headers, action: Action): Promise<Guarded> => {
      void headers;
      void action;
      return refuse();
    },
    open: (headers: Headers): Promise<Guarded> => {
      void headers;
      return refuse();
    },
    switchTo: (
      headers: Headers,
      workspaceId: string,
    ): Promise<{ ok: true } | { ok: false; refused: Refusal }> => {
      void headers;
      void workspaceId;
      return Promise.resolve({ ok: false, refused: 'no-session' });
    },
  };
}
