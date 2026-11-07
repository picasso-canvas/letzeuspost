import { parsePatternList } from '../lib/paths.ts';
import { doneWhenBoxes } from './evaluate.ts';
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
}

interface PrView {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
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
function changedFilesFromGit(git: Run, pr: number, sha: string): string[] {
  const ref = `refs/lzp/pr-${String(pr)}`;
  git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/pull/${String(pr)}/head:${ref}`]);
  const fetched = git(['rev-parse', ref]).trim();
  if (fetched !== sha) throw new Error(`PR head moved while checking (${fetched.slice(0, 7)})`);
  return git(['diff', '-z', '--name-only', '--no-renames', `origin/main...${sha}`])
    .split('\0')
    .filter((name) => name !== '');
}

export function collectFacts(pr: number, deps: CollectDeps, repo = REPO): Facts {
  const { gh } = deps;
  const config = parseConfig(deps.readMainFile('.github/merge-gate.json'));
  const sensitiveList = deps.readMainFile('.github/sensitive-paths.txt');

  let paused: string | null;
  try {
    paused = gh(['variable', 'get', 'AGENTS_PAUSED', '-R', repo]).trim();
  } catch {
    paused = null;
  }

  const fields =
    'state,isDraft,baseRefName,headRefOid,title,mergeable,body,labels,closingIssuesReferences';
  const view = JSON.parse(gh(['pr', 'view', String(pr), '-R', repo, '--json', fields])) as PrView;
  const sha = view.headRefOid;
  const changedFiles = changedFilesFromGit(deps.git, pr, sha);

  let behindBy: number | null;
  try {
    behindBy = Number(gh(['api', `repos/${repo}/compare/main...${sha}`, '--jq', '.behind_by']));
    if (!Number.isInteger(behindBy)) behindBy = null;
  } catch {
    behindBy = null;
  }

  const issuePrefix = `https://github.com/${repo}/issues/`;
  const closingIssues: ClosingIssue[] = view.closingIssuesReferences.map(({ number, url }) => {
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
    headSha: sha,
    title: view.title,
    mergeable: view.mergeable,
    behindBy,
    body: view.body,
    closingIssues,
    changedFiles: [...new Set(changedFiles)],
    labels: view.labels.map((label) => label.name),
    checkRuns,
    statuses,
    reviews: deps.readReviews(pr, sha),
    sensitivePatterns: sensitiveList === null ? null : parsePatternList(sensitiveList),
    config,
  };
}
