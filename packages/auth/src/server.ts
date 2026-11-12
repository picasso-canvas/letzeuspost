// packages/auth on the real database (#77): Better Auth's drizzle adapter on the auth handle (@lzp/db/auth, Q5),
// given Better Auth's four tables alone; the account emails' outbox and its `account-email` queue; the rate-limit
// table; and workspaces through `db.forWorkspace` and `forUser` (./workspaces.ts).
//
// The web app takes `authServer()`, one per process. The worker takes `createAccountEmails`, the outbox steps it
// delivers a sign-in email with: it never imports @lzp/db/auth itself (Athena's decision 3, 2026-11-11).
import { loadEnv, type Env } from '@lzp/config';
import { createDb, createJobs, type EmailOutbox, type Jobs } from '@lzp/db';
import {
  accountEmailOutbox,
  createAuthDb,
  queueAccountEmail,
  schema,
  type UserCtx,
} from '@lzp/db/auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createSignIn, kindOf, SIGN_IN_TEMPLATE } from './sign-in.ts';
import {
  createWorkspace,
  isMember,
  listWorkspaces,
  type NewWorkspace,
  type WorkspaceOfMember,
} from './workspaces.ts';

/** Better Auth's own tables, the only ones its adapter is given: never workspace, member or invitation. */
export const BETTER_AUTH_TABLES = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
};

/** The settings packages/auth reads: the web process's (config/env.ts). */
export type AuthServerEnv = Pick<
  Env<'web'>,
  'DATABASE_URL' | 'AUTH_SECRET' | 'APP_URL' | 'LZP_ENV'
>;

/** A signed-in person's session, as `getSession` gives it. */
export interface SessionRef {
  readonly token: string;
  readonly userId: string;
}

/** The queue's `send`, starting pg-boss on the first email: a web process that sends none never connects to it. */
function sendOnFirstUse(jobs: Jobs): { send: Jobs['send']; stop: () => Promise<void> } {
  let started: Promise<void> | undefined;
  return {
    send: async (queue, payload, options) => {
      started ??= jobs.start().catch((error: unknown) => {
        started = undefined;
        throw error;
      });
      await started;
      return jobs.send(queue, payload, options);
    },
    stop: async () => {
      if (started !== undefined) await jobs.stop();
    },
  };
}

export function createAuthServer(env: AuthServerEnv) {
  const db = createDb(env.DATABASE_URL);
  const authDb = createAuthDb(env.DATABASE_URL);
  const queue = sendOnFirstUse(
    createJobs({
      url: env.DATABASE_URL,
      db,
      onError: (error) => {
        console.error(`auth.jobs: ${kindOf(error)}`);
      },
    }),
  );
  const signIn = createSignIn({
    database: drizzleAdapter(authDb.db, { provider: 'pg', schema: BETTER_AUTH_TABLES }),
    secret: env.AUTH_SECRET,
    appUrl: env.APP_URL,
    environment: env.LZP_ENV,
    hitRateLimit: authDb.hitRateLimit,
    queueSignInEmail: async ({ userId, to, url }) => {
      await queueAccountEmail(authDb.db, queue, {
        userId,
        to,
        template: SIGN_IN_TEMPLATE,
        data: { url },
      });
    },
  });

  return {
    /** The route handler for /api/auth/* (apps/web). */
    handler: signIn.handler,
    getSession: signIn.getSession,
    createWorkspace: (owner: UserCtx, input: NewWorkspace) => createWorkspace(db, owner, input),
    listWorkspaces: (person: UserCtx): Promise<WorkspaceOfMember[]> =>
      listWorkspaces(authDb, person),
    /**
     * Makes `workspaceId` the session's active workspace if the session is `session.userId`'s and they are a member
     * of it; says whether it did. The workspace comes from the person's choice, so it is checked here, never trusted.
     */
    setActiveWorkspace: async (session: SessionRef, workspaceId: string): Promise<boolean> => {
      if (!(await isMember(authDb, { userId: session.userId }, workspaceId))) return false;
      const context = await signIn.auth.$context;
      const found = await context.internalAdapter.findSession(session.token);
      if (found?.session.userId !== session.userId) return false;
      await context.internalAdapter.updateSession(session.token, {
        activeWorkspaceId: workspaceId,
      });
      return true;
    },
    close: async () => {
      await queue.stop();
      await Promise.all([authDb.close(), db.close()]);
    },
  };
}

export type AuthServer = ReturnType<typeof createAuthServer>;

// Kept on globalThis so `next dev`'s module reloads don't open new pools on every edit.
const holder = globalThis as typeof globalThis & { lzpAuth?: AuthServer };

/** The web process's auth, made on first use from its settings (config/env.ts). */
export function authServer(): AuthServer {
  holder.lzpAuth ??= createAuthServer(loadEnv('web'));
  return holder.lzpAuth;
}

/** What the worker delivers sign-in emails with: the account emails' outbox, on the auth handle. */
export interface AccountEmails {
  readonly outbox: EmailOutbox;
  close: () => Promise<void>;
}

/** The worker's way to the account emails (`url` is its DATABASE_URL). */
export function createAccountEmails(url: string): AccountEmails {
  const authDb = createAuthDb(url);
  return { outbox: accountEmailOutbox(authDb.db), close: () => authDb.close() };
}
