// Tree stamps in ~/.letzeuspost/stamps/, where the builder can't write, one set per clone (named by its folder and a
// hash of its real path, so two clones with the same folder name never share one):
// - `<clone>.json`: the tree when the builder's own (sandboxed) `pnpm check` last passed;
// - `<clone>.pending.json`: the tree when that `pnpm check` started (PreToolUse);
// - `<clone>.base.json`: the tree when the session started.
// The hooks never run the check themselves: they run outside the sandbox, and running a builder's code there is
// exactly what §20 forbids.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readPlanted, readText, stateDir } from './hook-io.ts';

export type StampKind = 'green' | 'pending' | 'base';

export function stampPath(projectDir: string, kind: StampKind): string {
  let real = projectDir;
  try {
    real = realpathSync(projectDir);
  } catch {
    // A folder that's gone still gets a stable name.
  }
  const id = createHash('sha256').update(real).digest('hex').slice(0, 12);
  return join(
    stateDir(),
    'stamps',
    `${basename(real)}-${id}${kind === 'green' ? '' : `.${kind}`}.json`,
  );
}

export function writeStamp(
  projectDir: string,
  kind: StampKind,
  tree: string,
  session: string | null,
): void {
  const path = stampPath(projectDir, kind);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ tree, at: new Date().toISOString(), session }) + '\n');
}

export function stampedTree(projectDir: string, kind: StampKind): string | null {
  try {
    const value: unknown = JSON.parse(readText(stampPath(projectDir, kind)) ?? 'null');
    const tree = (value as { tree?: unknown } | null)?.tree;
    return typeof tree === 'string' ? tree : null;
  } catch {
    return null;
  }
}

/** The only command that can stamp a tree green: a bare `pnpm check` (or `pnpm run check`). */
export function isCheckCommand(command: string): boolean {
  return /^\s*pnpm\s+(?:run\s+)?check\s*$/.test(command);
}

export interface CheckRun {
  command: string;
  background: boolean;
  /** The Bash call's working folder, from the hook input. */
  cwd: string | undefined;
  response: Record<string, unknown> | undefined;
}

function scripts(packageJson: string | null): unknown {
  try {
    return (JSON.parse(packageJson ?? 'null') as { scripts?: unknown } | null)?.scripts ?? null;
  } catch {
    return null;
  }
}

function sameDir(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Whether a Bash call was a green `pnpm check` of the whole clone. PostToolUse fires only when the call succeeded (a
 * failure fires PostToolUseFailure), and Bash's response has no exit code, so only the bare command counts
 * (`pnpm check | tail` succeeds with a red check), in the foreground (a background run returns at once), from the
 * clone's root, with the root package.json `scripts` exactly as on main (so `check` can't be swapped for `true`).
 * pnpm's failure banner in the output is a last check.
 */
export function isGreenCheck(run: CheckRun, clone: string, harness: string): boolean {
  if (!isCheckCommand(run.command)) return false;
  if (run.background || run.response?.interrupted === true) return false;
  if (!sameDir(run.cwd, clone)) return false;
  const ours = scripts(readPlanted(join(clone, 'package.json')));
  if (ours === null || !isDeepStrictEqual(ours, scripts(readText(join(harness, 'package.json')))))
    return false;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const out = `${text(run.response?.stdout)}\n${text(run.response?.stderr)}`;
  return !/ELIFECYCLE|ERR_PNPM_|Command failed with exit code/.test(out);
}
