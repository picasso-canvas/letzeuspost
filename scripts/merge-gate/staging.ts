/** The merge log's lines this check reads (`~/.letzeuspost/merges.jsonl`). */
export interface StagingLogEntry {
  result: string;
  base?: string;
  mergeCommit?: string;
}

/**
 * The first-parent commits on `staging` (not on `main`) that the gate neither merged into `staging` nor made when it
 * merged `main` into `staging`. Nobody pushes to `staging` (the free plan has no branch rules), so any such commit is
 * a bypass: the batch gate refuses it, and the weekly report flags it and freezes.
 */
export function ungatedStagingCommits(
  firstParentShas: readonly string[],
  log: readonly StagingLogEntry[],
): string[] {
  const gated = new Set(
    log
      .filter(
        (e) => (e.result === 'merge-commit' && e.base === 'staging') || e.result === 'staging-sync',
      )
      .map((e) => e.mergeCommit)
      .filter((sha): sha is string => sha !== undefined && sha !== ''),
  );
  return firstParentShas.filter((sha) => !gated.has(sha));
}
