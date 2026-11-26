import { parseRawDiff, shipRefusals, type RawChange } from '../lib/protected.ts';
import { logMerge, readMergeLog, STATE_DIR } from './reviews.ts';

/** A command runner: stdout on success, a thrown error (with `stderr`) on failure. */
export type Run = (cmd: string, args: string[]) => string;

/** The merge log's lines this check reads (`~/.letzeuspost/merges.jsonl`). */
export interface StagingLogEntry {
  result: string;
  base?: string;
  mergeCommit?: string;
  /** For a merge into staging: the task issue (from the branch name). */
  issue?: number;
  pr?: number;
  /** `batch` for the PR from staging into main. */
  kind?: string;
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

/**
 * One merge-log line as the gate reads it: the fields it uses, each only when it has the right type. `pr` and `kind`
 * name a batch merged into main, which an earlier batch's follow-ups are checked against (Argus F1, Cerberus F1 on
 * #170).
 */
export function toStagingLogEntry(e: Record<string, unknown>): StagingLogEntry {
  return {
    result: String(e.result),
    ...(typeof e.base === 'string' ? { base: e.base } : {}),
    ...(typeof e.mergeCommit === 'string' ? { mergeCommit: e.mergeCommit } : {}),
    ...(typeof e.issue === 'number' ? { issue: e.issue } : {}),
    ...(typeof e.pr === 'number' ? { pr: e.pr } : {}),
    ...(typeof e.kind === 'string' ? { kind: e.kind } : {}),
  };
}

/** The merge log as the staging checks read it (dispatch, the batch, the gate): the one place that maps its lines. */
export function readStagingLog(stateDir?: string): StagingLogEntry[] {
  return readMergeLog(stateDir).map((e) => toStagingLogEntry(e));
}

/** What {@link syncStaging} did: whether staging now holds main, what to print, and the log line to write. */
export interface SyncResult {
  ok: boolean;
  message: string;
  entry: { result: 'staging-sync'; mergeCommit: string } | { result: 'staging-sync-failed' };
}

/**
 * Merges main into staging on GitHub (never the other way outside a batch PR), so builders always start from main's
 * harness. Safe to call any time: GitHub answers 204 when staging already holds main. A conflict is reported for Athena
 * to settle; dispatch refuses until staging contains main again.
 */
export function syncStaging(run: Run, repo: string): SyncResult {
  try {
    // 201 with the new merge commit, or 204 with no body when staging already contains main.
    const out = run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${repo}/merges`,
      '-f',
      'base=staging',
      '-f',
      'head=main',
      '-f',
      'commit_message=Merge main into staging (merge gate)',
    ]).trim();
    const parsed = out === '' ? {} : (JSON.parse(out) as { sha?: unknown });
    const sha = typeof parsed.sha === 'string' ? parsed.sha : '';
    return {
      ok: true,
      message:
        sha === ''
          ? 'staging already contains main.'
          : `Merged main into staging as ${sha.slice(0, 7)}.`,
      entry: { result: 'staging-sync', mergeCommit: sha },
    };
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    return {
      ok: false,
      message: `Couldn't merge main into staging: ${typeof stderr === 'string' ? stderr.trim() : 'unknown'}. Settle it before dispatching builders.`,
      entry: { result: 'staging-sync-failed' },
    };
  }
}

/**
 * {@link syncStaging}, with the gate's log line written either way (a sync commit not in the log is one the gate didn't
 * make, and the batch and the audit refuse it). Staging is synced on demand, not after every merge into main (#446):
 * dispatch and `batch.ts --open` call this; the caller prints the message.
 */
export function syncStagingAndLog(run: Run, repo: string, stateDir = STATE_DIR): SyncResult {
  const result = syncStaging(run, repo);
  logMerge({ at: new Date().toISOString(), ...result.entry }, stateDir);
  return result;
}

/** The `git fetch` of staging dispatch, the batch and the weekly report all use. */
const FETCH_STAGING = [
  '-c',
  'core.hooksPath=/dev/null',
  'fetch',
  '--quiet',
  '--no-tags',
  'origin',
  '+refs/heads/staging:refs/remotes/origin/staging',
];

/**
 * Why dispatch must not start a builder from staging now, or null: staging must contain current main (main's harness,
 * not an old copy, loads in the builder's session), may differ from main only by gated builder work, and holds no
 * commit that didn't come through the gate. A direct push to staging could otherwise put a hook or an agent file in
 * every builder's session (the free plan has no branch rules).
 */
export function stagingRefusal(run: Run, log: readonly StagingLogEntry[]): string | null {
  run('git', FETCH_STAGING);
  try {
    run('git', ['merge-base', '--is-ancestor', 'origin/main', 'origin/staging']);
  } catch {
    return "Refused: staging doesn't contain main (dispatch merges main into staging before it looks; a sync that failed has to be settled first).";
  }
  const problems = stagingProblems(
    parseRawDiff(
      run('git', [
        'diff',
        '--raw',
        '-z',
        '--no-renames',
        '--no-abbrev',
        'origin/main',
        'origin/staging',
      ]),
    ),
    ungatedStagingCommits(
      run('git', ['log', '--first-parent', '--format=%H', 'origin/main..origin/staging'])
        .split('\n')
        .filter((line) => line !== ''),
      log,
    ),
  );
  return problems.length > 0
    ? `Refused: staging isn't safe to build on:\n- ${problems.join('\n- ')}`
    : null;
}

/**
 * The weekly audit of staging: every first-parent commit on it that the gate didn't make, as findings. Only a missing
 * staging branch skips the audit; any other failure, `ls-remote` included, is a finding too, since then nobody knows
 * what staging holds (and a finding freezes).
 */
export function auditStaging(
  run: Run,
  log: readonly StagingLogEntry[],
  now: Date = new Date(),
): { sha: string; at: string; subject: string }[] {
  try {
    if (run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/staging']).trim() === '')
      return [];
    run('git', ['fetch', '--quiet', 'origin', '+refs/heads/staging:refs/remotes/origin/staging']);
    const onStaging = run('git', [
      'log',
      '--first-parent',
      '--format=%H%x09%cI%x09%s',
      'origin/main..origin/staging',
    ])
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [sha = '', at = '', ...subject] = line.split('\t');
        return { sha, at, subject: `on staging, not through the gate: ${subject.join('\t')}` };
      });
    const ungated = new Set(
      ungatedStagingCommits(
        onStaging.map((c) => c.sha),
        log,
      ),
    );
    return onStaging.filter((c) => ungated.has(c.sha));
  } catch (error) {
    return [
      {
        sha: '',
        at: now.toISOString(),
        subject: `couldn't audit staging: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
      },
    ];
  }
}

/**
 * What the gate says when a merge went through but its merge commit couldn't be read back. Into staging that matters
 * at once: with no `merge-commit` line, dispatch and the batch see the commit as one the gate didn't make.
 */
export function unreadMergeCommitNote(base: string, pr: number, headSha: string): string {
  if (base !== 'staging')
    return 'Merged (the merge commit could not be read back; the weekly audit will match it by PR).';
  const line = `{"at":"<now>","pr":${String(pr)},"sha":"${headSha}","result":"merge-commit","base":"staging","mergeCommit":"<the merge commit>"}`;
  return [
    'Merged into staging, but the merge commit could not be read back: dispatch and the batch will refuse staging until it is in the merge log.',
    `Read it with \`gh pr view ${String(pr)} --json mergeCommit\`, check it is the gate's squash of this PR, then append to ~/.letzeuspost/merges.jsonl:`,
    line,
  ].join('\n');
}
