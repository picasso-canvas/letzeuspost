// The tree hash of a clone's working tree (tracked and untracked, minus ignored files), without touching its index.
// Used by the green-check stamp (PostToolUse) and the Stop hook. git runs unsandboxed here, so it gets no chance to
// run anything from the clone: no fsmonitor, no hooks, no system config.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const SAFE = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.untrackedCache=false',
];

function git(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', [...SAFE, ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', ...env },
    timeout: 20_000,
  }).trim();
}

export function workingTree(dir: string): string {
  const scratch = mkdtempSync(join(tmpdir(), 'lzp-tree-'));
  try {
    const index = join(scratch, 'index');
    const real = git(dir, ['rev-parse', '--git-path', 'index']);
    const realIndex = isAbsolute(real) ? real : join(dir, real);
    if (existsSync(realIndex)) copyFileSync(realIndex, index);
    git(dir, ['add', '--all', '--', '.'], { GIT_INDEX_FILE: index });
    return git(dir, ['write-tree'], { GIT_INDEX_FILE: index });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The tree the task started from (merge base with origin/main), or null when there is none. */
export function baseTree(dir: string): string | null {
  try {
    const base = git(dir, ['merge-base', 'HEAD', 'origin/main']);
    return git(dir, ['rev-parse', `${base}^{tree}`]);
  } catch {
    return null;
  }
}
