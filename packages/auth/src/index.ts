// @lzp/auth: sign-in, sessions and workspaces (§13 Sign-in and sessions, #77). The only package that may import
// @lzp/db/auth (Q5). The web app mounts `authServer().handler` at /api/auth/*; the worker sends sign-in emails through
// `createAccountEmails`. Every server action, route handler and signed-in page starts with `guard()` (#79).
export {
  authServer,
  createAccountEmails,
  createAuthServer,
  type AccountEmails,
  type AuthServer,
  type AuthServerEnv,
  type SessionRef,
} from './server.ts';
export {
  AUTH_BASE_PATH,
  SERVED_ENDPOINTS,
  SESSION_DAYS,
  SIGN_IN_LINK_MINUTES,
  SIGN_IN_TEMPLATE,
  signInBucket,
  type AfterAnswer,
} from './sign-in.ts';
export type { NewWorkspace, WorkspaceOfMember } from './workspaces.ts';
export {
  createGuard,
  guard,
  type Allowed,
  type Guard,
  type GuardDeps,
  type Guarded,
  type GuardSession,
  type Refusal,
  type Refused,
} from './guard/index.ts';
