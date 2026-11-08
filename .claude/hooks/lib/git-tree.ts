// The tree hash of a clone's working tree (tracked and untracked files, minus ignored ones). Used for the green-check
// stamp, the base recorded at session start and the Stop hook.
//
// git runs unsandboxed here, so it must not read anything of the clone's repository: no config (filter drivers,
// fsmonitor, hooks), no index (skip-worktree bits could hide changes), no `commondir`, no `info/attributes`. The hook
// makes its own throwaway repository and only points `--work-tree` at the clone. From the clone, git reads file
// contents and `.gitignore`/`.gitattributes` as data; a `filter=` attribute does nothing without a driver in config,
// and the only config is the empty one created here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Throws when hashing takes longer than `budgetMs`: each hook passes less than its own timeout in the settings, so a
 * slow clone (PreToolUse's 15 s with `"onFailure": "block"`) skips the stamp instead of refusing the tool call.
 */
export function workingTree(clone: string, budgetMs: number): string {
  const deadline = Date.now() + budgetMs;
  const scratch = mkdtempSync(join(tmpdir(), 'lzp-tree-'));
  try {
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: scratch,
      XDG_CONFIG_HOME: scratch,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
    };
    const git = (args: string[]): string => {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`hashing ${clone} took longer than ${String(budgetMs)} ms`);
      return execFileSync('git', args, {
        cwd: scratch,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: left,
      }).trim();
    };
    const gitDir = join(scratch, 'repo.git');
    // Bare: `init <dir>` alone would put the repository in <dir>/.git, and --git-dir would miss it.
    git(['init', '-q', '--bare', gitDir]);
    const repo = ['--git-dir', gitDir, '--work-tree', clone, '-c', 'core.fsmonitor=false'];
    git([...repo, 'add', '--all', '--', '.']);
    return git([...repo, 'write-tree']);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
