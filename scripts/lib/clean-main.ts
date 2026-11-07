/** Runs a command in the repo and returns stdout; throws when it fails. */
export type Run = (cmd: string, args: string[]) => string;

/**
 * The harness scripts that judge PRs (the merge gate, the review runner) run only from a clean checkout of `main`
 * that matches `origin/main`, so a PR can never change the code or agent files that judge it.
 */
export function assertCleanMain(run: Run): string {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = run('git', ['symbolic-ref', '--short', 'HEAD']).trim();
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const remote = run('git', ['rev-parse', 'origin/main']).trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).trim();
  if (branch !== 'main' || head !== remote || dirty !== '') {
    throw new Error(
      `run this from a clean main that matches origin/main (branch ${branch}, ` +
        `HEAD ${head.slice(0, 7)}, origin/main ${remote.slice(0, 7)}, ${dirty === '' ? 'clean' : 'dirty'})`,
    );
  }
  return head;
}

/** A committed file on HEAD (`git show HEAD:<path>`), or null: an untracked draft never counts as main's. */
export function readMainFile(run: Run, path: string): string | null {
  try {
    return run('git', ['show', `HEAD:${path}`]);
  } catch {
    return null;
  }
}
