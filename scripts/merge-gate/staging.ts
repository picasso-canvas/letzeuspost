import { shipRefusals, type RawChange } from '../lib/protected.ts';

/** The merge log's lines this check reads (`~/.letzeuspost/merges.jsonl`). */
export interface StagingLogEntry {
  result: string;
  base?: string;
  mergeCommit?: string;
  /** For a merge into staging: the task issue (from the branch name). */
  issue?: number;
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

/**
 * The task issue of a builder branch, from its name (`<issue>-<slug>`, set by dispatch from Athena's record). GitHub
 * links "Closes #n" only for PRs into the default branch, so a PR into staging links no issue of its own.
 */
export function issueFromBranch(branch: string): number | null {
  const match = /^([1-9]\d*)-[a-z0-9-]+$/.exec(branch);
  return match ? Number(match[1]) : null;
}

/**
 * Why a builder may not start from staging: staging may differ from main only by builder work (nothing protected, no
 * symlink or submodule), and every commit on it must have come through the gate. A direct push to staging that
 * changes `.claude/` or `CLAUDE.md` would otherwise load in every builder's session.
 */
export function stagingProblems(
  mainToStaging: readonly RawChange[],
  ungated: readonly string[],
): string[] {
  return [
    ...shipRefusals(mainToStaging).filter((reason) => reason !== 'the branch changes nothing'),
    ...ungated.map(
      (sha) => `a commit on staging that didn't come through the gate: ${sha.slice(0, 7)}`,
    ),
  ];
}

/** How the gate merges each kind: a batch with a merge commit (staging stays); everything else squashed and deleted. */
export function mergeArgs(kind: 'staging' | 'batch' | 'main'): string[] {
  return kind === 'batch' ? ['--merge'] : ['--squash', '--delete-branch'];
}
