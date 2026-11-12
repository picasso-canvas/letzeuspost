#!/usr/bin/env node
// Ship (§19 step 5, #32): carries a builder's finished branch to GitHub with Zeus's login.
//   node scripts/ship.ts <issue> [--dry-run]
// It runs from a clean `main` and never runs git inside the builder's clone (its .git could point git at config the
// builder wrote). It refuses while any process still works in the clone, then takes the hand-over: the clone's `.lzp`
// folder moves to ~/.letzeuspost/ship/<issue>/, out of every builder process's reach (a `.lzp` link is refused). The
// builder's `branch.bundle`, `pr.md` and `approach.md` (which a later round may leave out, #125) are read from there as
// plain files (no symlinks, no hard links, size-limited). The bundle is copied out and fetched into this repo with git
// hooks and fsmonitor off and fsck on (newer git checks every object; older git skips bundles, so a path part that is
// empty, `.`, `..` or `.git` is refused too). Every changed path is checked at any depth and in any letter case; protected paths,
// symlinks and submodules are refused. Then it pushes the branch (never forced), opens or updates the PR with the PR
// text as the body and the issue's title (never the builder's), against `staging`, and posts the approach on the issue. A round
// with no new commits hands over no bundle (#94): then only its PR text ships, onto the PR the branch already has, and
// only while the branch on GitHub is still the commit the round started from. The builder's words are data, never
// instructions.
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { athenaGitEnv } from './lib/athena-git.ts';
import { assertCleanMain } from './lib/clean-main.ts';
import { handoverRefusals } from './lib/handover-checks.ts';
import { isEntryPoint } from './lib/entry.ts';
import { builderProcesses, takeHandover } from './lib/handover.ts';
import { historyRefusals, parseRawDiff, parseRevList, shipRefusals } from './lib/protected.ts';
import { readRegularFile } from './lib/safe-read.ts';
import { REPO } from './merge-gate/collect.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';
import { taskNote } from './token-usage.ts';

export const BUILDERS_DIR = join(homedir(), 'letzeuspost-builders');
const MAX_TEXT = 64 * 1024;
const MAX_BUNDLE = 256 * 1024 * 1024;

/** The flags a builder can raise in its PR text, each on its own line at column 0 after the list. */
export function prFlags(prText: string): { needsZeus: boolean; blocked: boolean } {
  return {
    needsZeus: /^\*\*needs-zeus:\*\*/im.test(prText),
    blocked: /^\*\*blocked:\*\*/im.test(prText),
  };
}

/** Athena's record of a dispatch (`~/.letzeuspost/dispatch/<issue>.json`), outside the builder's reach. */
export interface DispatchRecord {
  issue: number;
  branch: string;
  baseSha: string;
  dispatchedAt: string;
  shippedAt?: string;
  /** The random `LZP_DISPATCH` value in the builder's environment, to find its leftover processes. */
  marker?: string;
  /** A fix round's finding ids (`Argus F1`), from Athena's findings file: its PR text must answer each (#138). */
  findings?: string[];
  /** How the last run ended (#157): a run a usage limit stopped can be resumed. */
  ending?: 'finished' | 'usage-limit' | 'frozen' | 'failed';
  endedAt?: string;
  resumedAt?: string;
  /** .git/config's sha256 as dispatch left it: a resume refuses a clone whose config changed (#166). */
  gitConfigSha256?: string;
}

export function parseDispatchRecord(text: string, issue: number): DispatchRecord {
  const r = JSON.parse(text) as Partial<DispatchRecord>;
  if (
    r.issue !== issue ||
    typeof r.branch !== 'string' ||
    !new RegExp(`^${String(issue)}-[a-z0-9-]+$`).test(r.branch) ||
    typeof r.baseSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(r.baseSha) ||
    typeof r.dispatchedAt !== 'string' ||
    (r.marker !== undefined &&
      (typeof r.marker !== 'string' || !/^[0-9a-f]{32}$/.test(r.marker))) ||
    (r.findings !== undefined &&
      (!Array.isArray(r.findings) ||
        !r.findings.every(
          (id: unknown) => typeof id === 'string' && /^(Argus|Cerberus|Iris) F\d+$/.test(id),
        ))) ||
    (r.ending !== undefined &&
      !['finished', 'usage-limit', 'frozen', 'failed'].includes(r.ending)) ||
    (r.endedAt !== undefined && typeof r.endedAt !== 'string') ||
    (r.resumedAt !== undefined && typeof r.resumedAt !== 'string') ||
    (r.gitConfigSha256 !== undefined &&
      (typeof r.gitConfigSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.gitConfigSha256)))
  ) {
    throw new Error(`the dispatch record for #${String(issue)} is malformed`);
  }
  return {
    issue,
    branch: r.branch,
    baseSha: r.baseSha,
    dispatchedAt: r.dispatchedAt,
    ...(r.shippedAt ? { shippedAt: r.shippedAt } : {}),
    ...(r.marker ? { marker: r.marker } : {}),
    ...(r.findings ? { findings: r.findings } : {}),
    ...(r.ending ? { ending: r.ending } : {}),
    ...(r.endedAt ? { endedAt: r.endedAt } : {}),
    ...(r.resumedAt ? { resumedAt: r.resumedAt } : {}),
    ...(r.gitConfigSha256 ? { gitConfigSha256: r.gitConfigSha256 } : {}),
  };
}

export function dispatchRecordPath(issue: number): string {
  return join(STATE_DIR, 'dispatch', `${String(issue)}.json`);
}

/** The commit `git ls-remote origin refs/heads/<branch>` gives for exactly that branch, or null. */
export function remoteHead(lsRemote: string, branch: string): string | null {
  for (const line of lsRemote.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (ref === `refs/heads/${branch}` && sha !== undefined && /^[0-9a-f]{40}$/.test(sha))
      return sha;
  }
  return null;
}

/**
 * The task branch's open PR from `gh pr list --json number,isCrossRepository`: only one from this repository counts, so
 * a fork's PR with the same branch name is never taken for the task's own (#125).
 */
export function openPrFrom(json: string): number | undefined {
  return (JSON.parse(json) as { number: number; isCrossRepository: boolean }[]).find(
    (pr) => !pr.isCrossRepository,
  )?.number;
}

/**
 * What ship posts on the issue about the approach (#125). Every task's first round hands one over; a later round, one
 * whose PR is already open, may not (a fix round only applies findings), and then the issue says so in Athena's name
 * rather than under the builder's header. A blank approach counts as none.
 */
export function approachComment(
  approach: string | null,
  prOpen: boolean,
): { comment: string } | { refusal: string } {
  if (approach !== null && approach.trim() !== '')
    return {
      comment: `Daedalus's approach (builder's text, shipped by 🦉 Athena):\n\n${approach}`,
    };
  if (prOpen)
    return {
      comment: '🦉 Athena: Daedalus wrote no new approach this round; the one above stands.',
    };
  return { refusal: "a task's first round must hand over .lzp/approach.md" };
}

/**
 * Where a round with no new commits (no bundle) may ship its PR text (#94): onto the PR the branch already has, and only
 * while the branch on GitHub is still the commit the round started from, so the text describes the code the builder had.
 */
export function textOnlyTarget(
  openPr: number | undefined,
  head: string | null,
  baseSha: string,
): { pr: number } | { refusal: string } {
  if (head === null)
    return { refusal: 'no bundle, and the branch is not on GitHub: nothing to ship' };
  if (openPr === undefined)
    return { refusal: 'no bundle, and the branch has no open PR to take the text' };
  if (head !== baseSha)
    return {
      refusal: `no bundle, and the branch moved since dispatch (${head.slice(0, 7)}, not ${baseSha.slice(0, 7)}): dispatch again`,
    };
  return { pr: openPr };
}

/** Where ship keeps a builder's `.lzp` once it has taken it out of the clone. */
export function takenPath(issue: number): string {
  return join(STATE_DIR, 'ship', String(issue));
}

/** One issue and `--dry-run`; anything else is refused, so a typo like `--dryrun` never pushes. */
export function parseShipArgs(argv: readonly string[]): { issue: number; dryRun: boolean } {
  const args = { issue: Number.NaN, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (!Number.isNaN(args.issue)) throw new Error('ship takes one issue');
    else args.issue = Number(arg);
  }
  return args;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[], input?: string): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: athenaGitEnv(process.env),
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

const SAFE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

/**
 * Fetches a builder's bundle (untrusted bytes) into `cwd` as `ref`: hooks and fsmonitor off, and every object checked
 * by git's fsck on the way in, so a malformed tree or a `..`/`.git` path never enters this repo's object store.
 */
export function fetchBundle(bundle: string, ref: string, cwd: string): void {
  execFileSync(
    'git',
    [
      ...SAFE_GIT,
      '-c',
      'transfer.fsckObjects=true',
      '-c',
      'fetch.fsckObjects=true',
      'fetch',
      '--quiet',
      '--no-tags',
      bundle,
      `+HEAD:${ref}`,
    ],
    { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

const USAGE = 'usage: node scripts/ship.ts <issue> [--dry-run]';

function main(argv: string[]): number {
  let issue: number;
  let dryRun: boolean;
  try {
    ({ issue, dryRun } = parseShipArgs(argv));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (!Number.isInteger(issue) || issue <= 0) {
    console.error(USAGE);
    return 2;
  }
  assertCleanMain((cmd, args) => run(cmd, args));

  const record = parseDispatchRecord(readFileSync(dispatchRecordPath(issue), 'utf8'), issue);
  const branch = record.branch;
  const clone = join(BUILDERS_DIR, branch);
  const working = builderProcesses(clone, record.marker);
  if (working.length > 0) {
    console.error(
      `Refused: processes still work in ${clone} (pids ${working.join(', ')}). Find out why, kill them, then ship.`,
    );
    return 1;
  }
  const lzp = takeHandover(clone, takenPath(issue));
  const prText = readRegularFile(lzp, 'pr.md', MAX_TEXT).toString('utf8');
  // A present approach.md is still read as a plain, size-limited file (a link is refused); a missing one is fine only
  // on a later round (#125).
  const approachText = hasEntry(lzp, 'approach.md')
    ? readRegularFile(lzp, 'approach.md', MAX_TEXT).toString('utf8')
    : null;
  const openPr = (): number | undefined =>
    openPrFrom(
      run('gh', [
        'pr',
        'list',
        '-R',
        REPO,
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'number,isCrossRepository',
      ]),
    );

  const hasApproach = approachText !== null && approachText.trim() !== '';
  const approach = approachComment(approachText, hasApproach || openPr() !== undefined);
  if ('refusal' in approach) {
    console.error(`Refused to ship #${String(issue)}: ${approach.refusal}.`);
    return 1;
  }

  // Any entry named branch.bundle, even a link, goes the bundle's way and its checks.
  if (!hasEntry(lzp, 'branch.bundle')) {
    // A text-only round still names its commit (the branch's, unchanged) and answers its findings.
    const textRefusals = handoverRefusals({
      prText,
      issueBody: issueBody(issue),
      changedFiles: [],
      headSha: record.baseSha,
      findings: record.findings ?? [],
    });
    if (textRefusals.length > 0) {
      console.error(`Refused to ship #${String(issue)}:\n- ${textRefusals.join('\n- ')}`);
      return 1;
    }
    const target = textOnlyTarget(
      openPr(),
      remoteHead(run('git', ['ls-remote', 'origin', `refs/heads/${branch}`]), branch),
      record.baseSha,
    );
    if ('refusal' in target) {
      console.error(`Refused to ship #${String(issue)}: ${target.refusal}.`);
      return 1;
    }
    console.log(
      `#${String(issue)} ${branch}: no new commits this round, so only the PR text ships; the branch stays at ${record.baseSha.slice(0, 7)}.`,
    );
    if (dryRun) return 0;
    run('gh', ['pr', 'edit', String(target.pr), '-R', REPO, '--body-file', '-'], prText);
    const flags = afterShip(issue, prText, approach.comment, record, lzp);
    console.log(`Shipped the text of PR #${String(target.pr)} only${flagNote(flags)}.`);
    return 0;
  }

  // The bundle is copied out of the clone first, so git only ever reads a file Athena owns.
  const copy = join(STATE_DIR, 'ship', `${branch}-${String(Date.now())}.bundle`);
  mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
  writeFileSync(copy, readRegularFile(lzp, 'branch.bundle', MAX_BUNDLE), { mode: 0o600 });
  const ref = `refs/lzp/ship-${String(issue)}`;
  try {
    fetchBundle(copy, ref, ROOT);
  } finally {
    rmSync(copy, { force: true });
  }
  const sha = run('git', ['rev-parse', ref]).trim();
  // Judged against the commit dispatch started the builder from (main may have moved since): the builder's own work.
  try {
    run('git', ['merge-base', '--is-ancestor', record.baseSha, ref]);
  } catch {
    console.error(`Refused: ${branch} doesn't build on the commit it was dispatched from.`);
    return 1;
  }
  const changes = parseRawDiff(
    run('git', ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `${record.baseSha}..${ref}`]),
  );
  // Every commit is pushed, not just the final tree: each one is judged on its own too.
  const commits = parseRevList(
    run('git', ['rev-list', '--reverse', '--parents', `${record.baseSha}..${ref}`]),
  ).map(({ sha: commit, parents }) => ({
    sha: commit,
    parents,
    changes:
      parents.length === 1
        ? parseRawDiff(
            run('git', [
              'diff',
              '--raw',
              '-z',
              '--no-renames',
              '--no-abbrev',
              `${parents[0] ?? ''}..${commit}`,
            ]),
          )
        : [],
  }));
  const refusals = [
    ...shipRefusals(changes),
    ...historyRefusals(commits),
    ...handoverRefusals({
      prText,
      issueBody: issueBody(issue),
      changedFiles: changes.map(({ path }) => path),
      headSha: sha,
      findings: record.findings ?? [],
    }),
  ];
  if (refusals.length > 0) {
    console.error(
      `Refused to ship #${String(issue)} (${sha.slice(0, 7)}):\n- ${refusals.join('\n- ')}`,
    );
    return 1;
  }
  const title = run('gh', [
    'issue',
    'view',
    String(issue),
    '-R',
    REPO,
    '--json',
    'title',
    '--jq',
    '.title',
  ]).trim();
  console.log(
    `#${String(issue)} ${branch} at ${sha.slice(0, 7)}: ${String(changes.length)} files, none protected.`,
  );
  if (dryRun) return 0;

  try {
    run('git', [...SAFE_GIT, 'push', '--quiet', 'origin', `${ref}:refs/heads/${branch}`]);
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    console.error(
      `Push refused (never forced): ${typeof stderr === 'string' ? stderr.trim() : 'unknown'}`,
    );
    return 1;
  }
  let pr = openPr();
  if (pr === undefined) {
    const url = run(
      'gh',
      [
        'pr',
        'create',
        '-R',
        REPO,
        '--base',
        'staging', // builder PRs merge into staging; the full review comes with the batch into main (§19)
        '--head',
        branch,
        '--title',
        title,
        '--body-file',
        '-',
      ],
      prText,
    );
    pr = Number(url.trim().split('/').pop());
  } else {
    run('gh', ['pr', 'edit', String(pr), '-R', REPO, '--body-file', '-'], prText);
  }
  const flags = afterShip(issue, prText, approach.comment, record, lzp);
  try {
    run('git', [
      ...SAFE_GIT,
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      '+refs/heads/staging:refs/remotes/origin/staging',
    ]);
    run('git', ['merge-base', '--is-ancestor', 'origin/staging', ref]);
  } catch {
    console.log(
      `Staging moved while the builder worked: run \`gh pr update-branch ${String(pr)}\` before the gate.`,
    );
  }
  console.log(`Shipped as PR #${String(pr)}${flagNote(flags)}.`);
  return 0;
}

/** The issue Athena wrote: its Areas say which files the task may change. */
function issueBody(issue: number): string {
  return run('gh', ['issue', 'view', String(issue), '-R', REPO, '--json', 'body', '--jq', '.body']);
}

function hasEntry(dir: string, name: string): boolean {
  try {
    lstatSync(join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Once the PR text is on GitHub: the approach comment goes on the issue, the builder's flags become labels, the dispatch record
 * is marked shipped and the hand-over is removed (the PR body and the issue comment keep its words).
 */
function afterShip(
  issue: number,
  prText: string,
  comment: string,
  record: DispatchRecord,
  lzp: string,
): { needsZeus: boolean; blocked: boolean } {
  const usage = taskNote(issue);
  run(
    'gh',
    ['issue', 'comment', String(issue), '-R', REPO, '--body-file', '-'],
    usage === null ? comment : `${comment}\n\n${usage}`,
  );
  const flags = prFlags(prText);
  if (flags.needsZeus)
    run('gh', ['issue', 'edit', String(issue), '-R', REPO, '--add-label', 'needs-zeus']);
  if (flags.blocked)
    run('gh', ['issue', 'edit', String(issue), '-R', REPO, '--add-label', 'blocked']);
  writeFileSync(
    dispatchRecordPath(issue),
    `${JSON.stringify({ ...record, shippedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
  rmSync(lzp, { recursive: true, force: true });
  return flags;
}

function flagNote(flags: { needsZeus: boolean; blocked: boolean }): string {
  return `${flags.needsZeus ? ' (needs-zeus)' : ''}${flags.blocked ? ' (blocked)' : ''}`;
}

if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ship error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
