// The "last green pnpm check" stamp: the tree hash at the moment a builder's own (sandboxed) `pnpm check` passed.
// Kept in ~/.letzeuspost/stamps/, where the builder can't write. The hook never runs the check itself: hooks run
// outside the sandbox, and running a builder's code there is exactly what §20 forbids.
import { basename, join } from 'node:path';
import { stateDir } from './hook-io.ts';

export function stampPath(projectDir: string): string {
  return join(stateDir(), 'stamps', `${basename(projectDir)}.json`);
}

/**
 * PostToolUse fires only when the Bash call succeeded (a failure fires PostToolUseFailure), and Bash's response has
 * no exit code. So only the bare command counts: `pnpm check | tail` would succeed with a red check. pnpm's failure
 * banner in the output is a second line of defence.
 */
export function isGreenCheck(
  command: string,
  response: Record<string, unknown> | undefined,
): boolean {
  if (!/^\s*pnpm\s+(?:run\s+)?check\s*$/.test(command)) return false;
  if (response?.interrupted === true) return false;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const out = `${text(response?.stdout)}\n${text(response?.stderr)}`;
  return !/ELIFECYCLE|ERR_PNPM_|Command failed with exit code/.test(out);
}
