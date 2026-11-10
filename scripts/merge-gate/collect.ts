import { parsePatternList } from '../lib/paths.ts';
import { agentFor } from './agents.ts';
import { changeId, reviewsAt } from './carry.ts';
import { issueFromBranch, ungatedStagingCommits, type StagingLogEntry } from './staging.ts';
import { featureOf } from '../lib/features.ts';
import { wantsComments, type OpenIssue } from '../lib/follow-ups.ts';
import { parseJourneyReport } from '../lib/journey-proof.ts';
import { numberedFindings, parseAreas } from '../lib/handover-checks.ts';
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
  /** The `journeys` artifact of an Actions run, as file name → text, or null when it has none (#156). */
  readJourneyReport?: (runId: number) => Record<string, string> | null;
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

const NAMES: Record<Exclude<ReviewRecord['reviewer'], 'redteam'>, string> = {
  argus: 'Argus',
  cerberus: 'Cerberus',
  iris: 'Iris',
};

/**
 * For the hand-over checks on Athena's PRs (#138): the commits the evidence may name (the head, and any reviewed commit
 * whose change is the same, as carry.ts decides), and the numbered findings of the latest review round before them.
 */
function handoverFacts(
  pr: number,
  sha: string,
  base: string,
  deps: CollectDeps,
): { evidenceShas: string[]; earlierFindingIds: string[] } {
  const reviewed = deps.listReviewedShas?.(pr) ?? [];
  const idOf = (commit: string): string | null => {
    try {
      return changeId(deps.git, commit, base);
    } catch {
      return null;
    }
  };
  const head = idOf(sha);
  const evidenceShas = [
    sha,
    ...reviewed.filter((commit) => commit !== sha && head !== null && idOf(commit) === head),
  ];
  const earlier = reviewed
    .filter((commit) => !evidenceShas.includes(commit))
    .map((commit) => deps.readReviews(pr, commit).filter(isReview))
    .filter((records) => records.length > 0)
    .sort((a, b) => latest(b) - latest(a))[0];
  const earlierFindingIds = [
    ...new Set(
      (earlier ?? []).flatMap((r) =>
        numberedFindings(r.summary).map((n) => `${NAMES[r.reviewer]} F${String(n)}`),
      ),
    ),
  ];
  return { evidenceShas, earlierFindingIds };
}

/** A reviewer's record, not Athena's red-team one. */
function isReview(
  r: ReviewRecord,
): r is ReviewRecord & { reviewer: Exclude<ReviewRecord['reviewer'], 'redteam'> } {
  return r.reviewer !== 'redteam';
}

function latest(records: readonly ReviewRecord[]): number {
  return Math.max(...records.map((r) => Date.parse(r.at)));
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
  const verdict = verified ? parseVerdict(r.summary, r.reviewer).verdict : r.verdict;
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
  // A batch is held by an earlier batch's open follow-ups (#154); only a batch needs these.
  const isBatch = view.baseRefName === 'main' && view.headRefName === 'staging';
  const mergedBatches = mergeLog
    .filter((e) => e.result === 'merged' && e.kind === 'batch' && typeof e.pr === 'number')
    .map((e) => e.pr as number);
  // Every open issue's text (a planned task's follow-up item); the comments, with their authors, of a follow-up and of a
  // task with an unticked follow-up item, for an exception (Argus F2 in round 2 on #170). A list that reaches its limit
  // may be cut off, and the gate refuses then (#170).
  const ISSUE_LIMIT = 1000;
  const listed = isBatch
    ? (JSON.parse(
        gh([
          'issue',
          'list',
          '-R',
          repo,
          '--state',
          'open',
          '--limit',
          String(ISSUE_LIMIT),
          '--json',
          'number,labels,body',
        ]),
      ) as { number: number; labels: { name: string }[]; body: string }[])
    : [];
  const openIssuesCutOff = listed.length >= ISSUE_LIMIT;
  const openIssues: OpenIssue[] = listed.map((i) => {
    const labels = i.labels.map((l) => l.name);
    const comments = wantsComments(labels, i.body)
      ? (
          JSON.parse(gh(['issue', 'view', String(i.number), '-R', repo, '--json', 'comments'])) as {
            comments: { author: { login: string } | null; body: string }[];
          }
        ).comments.map((c) => ({ author: c.author?.login ?? '', body: c.body }))
      : [];
    return { number: i.number, labels, body: i.body, comments };
  });
  // With their authors: only Zeus's account links a follow-up (Argus F1 in round 2 on #170).
  const prComments: { author: string; body: string }[] = isBatch
    ? (
        JSON.parse(gh(['pr', 'view', String(pr), '-R', repo, '--json', 'comments'])) as {
          comments: { author: { login: string } | null; body: string }[];
        }
      ).comments.map((c) => ({ author: c.author?.login ?? '', body: c.body }))
    : [];
  const closingIssues: ClosingIssue[] = references.map(({ number, url }) => {
    if (!url.startsWith(issuePrefix))
      return { number, inRepo: false, labels: [], doneWhenBoxes: 0, areas: null };
    const issue = JSON.parse(
      gh(['issue', 'view', String(number), '-R', repo, '--json', 'labels,body']),
    ) as { labels: { name: string }[]; body: string };
    const boxes = doneWhenBoxes(issue.body);
    const areas = parseAreas(issue.body);
    return {
      number,
      inRepo: true,
      labels: issue.labels.map((label) => label.name),
      doneWhenBoxes: boxes.ticked + boxes.unticked,
      areas: 'patterns' in areas ? areas.patterns : null,
    };
  });

  const checkRuns = jsonLines<CheckRun>(
    gh([
      'api',
      `repos/${repo}/commits/${sha}/check-runs`,
      '--paginate',
      '--jq',
      '.check_runs[] | {name, status, conclusion, app: .app.slug, url: .details_url}',
    ]),
  );
  // A batch that completes a feature is held until the services run on its head shows the journey passed (§19, #156).
  // A part of a feature (another of its build tasks still open) isn't: its journey is still marked, by design. The gate
  // names the open tasks that made it a part (Argus F3, Cerberus F2 on #171).
  let journey: Facts['journey'] = null;
  let journeyPart: Facts['journeyPart'] = null;
  if (isBatch) {
    const features = [
      ...new Set(
        closingIssues
          .filter((i) => i.inRepo)
          .map((i) => featureOf(i.labels))
          .filter((x) => x !== null),
      ),
    ];
    if (features.length > 1)
      throw new Error(
        `the batch closes tasks of two features (${features.join(', ')}): §19 batches one feature at a time`,
      );
    const feature = features[0];
    if (feature !== undefined) {
      const open = (
        JSON.parse(
          gh([
            'issue',
            'list',
            '-R',
            repo,
            '--label',
            `feature:${feature}`,
            '--state',
            'open',
            '--limit',
            '1000',
            '--json',
            'number,labels',
          ]),
        ) as { number: number; labels: { name: string }[] }[]
      )
        // Only a build task makes the feature unfinished: a stray issue with the label doesn't (Argus F3 on #171).
        .filter((i) => i.labels.some((l) => l.name === 'build-task'))
        .map((i) => i.number);
      // This repository's issues only: another's #73 isn't this feature's task (Argus F4 on #171).
      const closes = new Set(closingIssues.filter((i) => i.inRepo).map((i) => i.number));
      const rest = open.filter((n) => !closes.has(n));
      if (rest.length > 0) journeyPart = { feature, open: rest };
      else {
        const services = checkRuns.find((r) => r.name === 'services' && r.app === 'github-actions');
        const runId = /\/actions\/runs\/(\d+)\//.exec(services?.url ?? '')?.[1];
        const files =
          runId === undefined ? null : (deps.readJourneyReport?.(Number(runId)) ?? null);
        const parsed = files === null ? null : parseJourneyReport(files);
        journey =
          typeof parsed === 'string'
            ? { feature, entries: null, unreadable: parsed }
            : { feature, entries: parsed };
      }
    }
  }
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
    openIssues,
    openIssuesCutOff,
    mergedBatches,
    prComments,
    ...handoverFacts(pr, sha, base, deps),
    labels: view.labels.map((label) => label.name),
    checkRuns,
    journey,
    journeyPart,
    statuses,
    reviews: reviewsFor(pr, sha, base, deps),
    sensitivePatterns: sensitiveList === null ? null : parsePatternList(sensitiveList),
    cerberusPatterns: cerberusList === null ? null : parsePatternList(cerberusList),
    config,
  };
}
