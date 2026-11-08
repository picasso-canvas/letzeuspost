import { parsePatternList } from '../lib/paths.ts';
import { agentFor } from './agents.ts';
import { changeId, reviewsAt } from './carry.ts';
import { issueFromBranch, ungatedStagingCommits, type StagingLogEntry } from './staging.ts';
import { parseRawDiff } from '../lib/protected.ts';
import { bodyHash, doneWhenBoxes } from './evaluate.ts';
import { bundlePattern, checkTranscript } from './meta.ts';
import { parseVerdict } from './verdict.ts';
import type { CheckRun, ClosingIssue, Facts, GateConfig, ReviewRecord } from './types.ts';

export const REPO = 'picasso-canvas/letzeuspost';

/** Runs a command with these arguments and returns stdout; throws when it fails. */
export type Run = (args: string[]) => string;

export interface CollectDeps {
  gh: Run;
  /** git in Athena's clean `main` checkout. */
  git: Run;
  /** A file from `main`'s tree (`git show HEAD:<path>`), or null when it doesn't exist. */
  readMainFile: (path: string) => string | null;
  readReviews: (pr: number, sha: string) => ReviewRecord[];
  /** The PR's commits that have review records; their reviews carry to the head when the change is the same. */
  listReviewedShas?: (pr: number) => string[];
  /** The gate's merge log (`merges.jsonl`); a batch is checked against it. Missing: nothing counts as gated. */
  readMergeLog?: () => StagingLogEntry[];
  /** A Claude Code transcript by session id, or null. */
  readTranscript?: (sessionId: string) => string | null;
  /** Where bundles live (`~/.letzeuspost`). */
  stateDir?: string;
  /** A file's text, or null (bundle snapshots). */
  readFile?: (path: string) => string | null;
}

/** Each record verified at its own commit; reviews from before an update from main carry to the head (carry.ts). */
function reviewsFor(pr: number, sha: string, base: string, deps: CollectDeps): ReviewRecord[] {
  const list = deps.listReviewedShas;
  if (list === undefined) return deps.readReviews(pr, sha).map((r) => verify(r, pr, sha, deps));
  return reviewsAt(pr, sha, {
    readReviews: deps.readReviews,
    listReviewedShas: list,
    changeId: (commit) => changeId(deps.git, commit, base),
    verify: (r, commit) => verify(r, pr, commit, deps),
  });
}

/** The gate re-checks every runner-made review against its transcript; anything that doesn't check out isn't verified. */
function verify(r: ReviewRecord, pr: number, sha: string, deps: CollectDeps): ReviewRecord {
  const meta = r.meta as ReviewRecord['meta'] | null;
  if (meta === undefined) return r;
  if (meta === null || typeof meta !== 'object')
    return { ...r, meta: { agent: '', sessionId: null, verified: false } };
  let verified = false;
  const { sessionId, bundle } = meta;
  const agent = agentFor(r.reviewer);
  if (
    agent !== undefined &&
    meta.agent === agent &&
    sessionId &&
    bundle &&
    deps.readTranscript &&
    deps.stateDir
  ) {
    if (bundlePattern(deps.stateDir, pr, sha).test(bundle)) {
      let text: string | null;
      try {
        text = deps.readTranscript(sessionId);
      } catch {
        text = null;
      }
      verified =
        checkTranscript(text, agent, bundle, r.summary) === null &&
        snapshotMatches(bundle, r, sha, deps);
    }
  }
  // A verified record's verdict is the one in the session's own answer, never the record's field.
  const verdict = verified ? parseVerdict(r.summary).verdict : r.verdict;
  return { ...r, verdict, meta: { ...meta, verified } };
}

/** The record's PR text and commit must be the ones in the bundle the reviewer was given. */
function snapshotMatches(bundle: string, r: ReviewRecord, sha: string, deps: CollectDeps): boolean {
  if (!deps.readFile) return false;
  try {
    const text = deps.readFile(`${bundle}/snapshot.json`);
    if (text === null) return false;
    const snap = JSON.parse(text) as { headRefOid?: unknown; body?: unknown };
    return (
      snap.headRefOid === sha && typeof snap.body === 'string' && bodyHash(snap.body) === r.bodyHash
    );
  } catch {
    return false;
  }
}

interface PrView {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  title: string;
  mergeable: string;
  body: string;
  labels: { name: string }[];
  closingIssuesReferences: { number: number; url: string }[];
}

function jsonLines<T>(text: string): T[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

export function parseConfig(text: string | null): GateConfig {
  if (text === null) throw new Error('.github/merge-gate.json is missing on main');
  const raw = JSON.parse(text) as Partial<GateConfig>;
  const list = (value: unknown, name: string): string[] => {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      throw new Error(`merge-gate.json: ${name} must be a list of strings`);
    }
    return value;
  };
  return {
    requiredChecks: list(raw.requiredChecks, 'requiredChecks'),
    requiredChecksIntoMain:
      raw.requiredChecksIntoMain === undefined
        ? []
        : list(raw.requiredChecksIntoMain, 'requiredChecksIntoMain'),
    requireTierLabel: raw.requireTierLabel === true,
    requireIris: raw.requireIris === true,
    uiPaths: list(raw.uiPaths, 'uiPaths'),
    harnessPaths: list(raw.harnessPaths, 'harnessPaths'),
  };
}

/**
 * The changed files from git itself (GitHub's files API stops at 3000). `--no-renames` lists a rename under both
 * names, so moving a file out of a sensitive folder is sensitive; `-z` keeps odd file names whole.
 */
export function changedFilesFromGit(git: Run, pr: number, sha: string, base = 'main'): string[] {
  if (base !== 'main' && base !== 'staging')
    throw new Error(`the gate merges into main or staging, not ${base}`);
  const ref = `refs/lzp/pr-${String(pr)}`;
  git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/pull/${String(pr)}/head:${ref}`]);
  if (base === 'staging')
    git([
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      '+refs/heads/staging:refs/remotes/origin/staging',
    ]);
  const fetched = git(['rev-parse', ref]).trim();
  if (fetched !== sha) throw new Error(`PR head moved while checking (${fetched.slice(0, 7)})`);
  return git(['diff', '-z', '--name-only', '--no-renames', `origin/${base}...${sha}`])
    .split('\0')
    .filter((name) => name !== '');
}

export function collectFacts(pr: number, deps: CollectDeps, repo = REPO): Facts {
  const { gh } = deps;
  const config = parseConfig(deps.readMainFile('.github/merge-gate.json'));
  const sensitiveList = deps.readMainFile('.github/sensitive-paths.txt');
  const cerberusList = deps.readMainFile('.github/cerberus-paths.txt');

  let paused: string | null;
  try {
    paused = gh(['variable', 'get', 'AGENTS_PAUSED', '-R', repo]).trim();
  } catch {
    paused = null;
  }

  const fields =
    'state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,title,mergeable,body,labels,closingIssuesReferences';
  const view = JSON.parse(gh(['pr', 'view', String(pr), '-R', repo, '--json', fields])) as PrView;
  const sha = view.headRefOid;
  // Only main and staging are targets; anything else is refused by the gate before git sees the name.
  const base = view.baseRefName === 'staging' ? 'staging' : 'main';
  const changedFiles = changedFilesFromGit(deps.git, pr, sha, base);
  const changes = parseRawDiff(
    deps.git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `origin/${base}...${sha}`]),
  );
  const mergeLog = deps.readMergeLog?.() ?? [];
  // A batch: every commit on staging must have come through the gate (merged into staging, or main synced into it).
  let ungatedStaging: string[] = [];
  if (base === 'main' && view.headRefName === 'staging' && !view.isCrossRepository) {
    deps.git([
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      '+refs/heads/staging:refs/remotes/origin/staging',
    ]);
    const shas = deps
      .git(['log', '--first-parent', '--format=%H', 'origin/main..origin/staging'])
      .split('\n')
      .filter((line) => line !== '');
    ungatedStaging = ungatedStagingCommits(shas, mergeLog);
  }

  let behindBy: number | null;
  try {
    behindBy = Number(gh(['api', `repos/${repo}/compare/${base}...${sha}`, '--jq', '.behind_by']));
    if (!Number.isInteger(behindBy)) behindBy = null;
  } catch {
    behindBy = null;
  }

  const issuePrefix = `https://github.com/${repo}/issues/`;
  // GitHub links no issues for a PR into staging: the task issue comes from the branch name dispatch gave it.
  const stagingIssue = base === 'staging' ? issueFromBranch(view.headRefName) : null;
  const references =
    base === 'staging'
      ? stagingIssue === null
        ? []
        : [
            {
              number: stagingIssue,
              url: `https://github.com/${repo}/issues/${String(stagingIssue)}`,
            },
          ]
      : view.closingIssuesReferences;
  const gatedIssues = mergeLog
    .filter((e) => e.result === 'merged' && e.base === 'staging' && typeof e.issue === 'number')
    .map((e) => e.issue as number);
  const closingIssues: ClosingIssue[] = references.map(({ number, url }) => {
    if (!url.startsWith(issuePrefix))
      return { number, inRepo: false, labels: [], doneWhenBoxes: 0 };
    const issue = JSON.parse(
      gh(['issue', 'view', String(number), '-R', repo, '--json', 'labels,body']),
    ) as { labels: { name: string }[]; body: string };
    const boxes = doneWhenBoxes(issue.body);
    return {
      number,
      inRepo: true,
      labels: issue.labels.map((label) => label.name),
      doneWhenBoxes: boxes.ticked + boxes.unticked,
    };
  });

  const checkRuns = jsonLines<CheckRun>(
    gh([
      'api',
      `repos/${repo}/commits/${sha}/check-runs`,
      '--paginate',
      '--jq',
      '.check_runs[] | {name, status, conclusion, app: .app.slug}',
    ]),
  );
  const statuses = jsonLines<{ context: string; state: string }>(
    gh([
      'api',
      `repos/${repo}/commits/${sha}/status`,
      '--paginate',
      '--jq',
      '.statuses[] | {context, state}',
    ]),
  );

  return {
    pr,
    paused,
    state: view.state,
    isDraft: view.isDraft,
    baseRef: view.baseRefName,
    headRef: view.headRefName,
    crossRepo: view.isCrossRepository,
    headSha: sha,
    title: view.title,
    mergeable: view.mergeable,
    behindBy,
    body: view.body,
    closingIssues,
    changedFiles: [...new Set(changedFiles)],
    changes,
    ungatedStaging,
    gatedIssues,
    labels: view.labels.map((label) => label.name),
    checkRuns,
    statuses,
    reviews: reviewsFor(pr, sha, base, deps),
    sensitivePatterns: sensitiveList === null ? null : parsePatternList(sensitiveList),
    cerberusPatterns: cerberusList === null ? null : parsePatternList(cerberusList),
    config,
  };
}
