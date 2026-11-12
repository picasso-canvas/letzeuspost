// The web process's guard (§13 The app's API, #79), on packages/auth's server: its session, the person's workspaces
// through `forUser`, and the session's active workspace. One per process, like `authServer()`.
import { authServer } from '../server.ts';
import { createGuard, type Guard } from './guard.ts';

export {
  createGuard,
  type Allowed,
  type Guard,
  type GuardDeps,
  type Guarded,
  type GuardSession,
  type Refusal,
  type Refused,
} from './guard.ts';

// Kept on globalThis, as `authServer()` is, so `next dev`'s module reloads don't make a new one on every edit.
const holder = globalThis as typeof globalThis & { lzpGuard?: Guard };

/** The guard every server action, route handler and signed-in page of the web app starts with. */
export function guard(): Guard {
  holder.lzpGuard ??= createGuard(authServer());
  return holder.lzpGuard;
}
