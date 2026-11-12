#!/usr/bin/env node
// The review runner (§19, #46): one command runs the reviews a PR needs and records each verdict.
//   node scripts/review.ts <pr> [--dry-run]
// It runs from a clean `main`, so the agent files and this script are main's, never the PR's. It builds a bundle in
// ~/.letzeuspost/bundles/pr-<n>/<stamp>/ that holds the snapshot, the PR's files as regular blobs only (no .git;
// symlinks and submodules as text stubs; .gitattributes ignored; CLAUDE.md, .claude/ and search-ignore files renamed;
// any name collision refused), the diff and history as text (merge diffs included), the issues, CI results and
// comments. It runs Argus, plus Cerberus on sensitive PRs and Iris on UI PRs once enabled, each headless from main's
// checkout with a minimal environment and no .env reads, and records each verdict with record-review.ts. Summaries go
// to pr-<n>/out/<stamp>/, outside the bundle, so each reviewer starts fresh. A builder's code is only read here.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCleanMain, readMainFile } from './lib/clean-main.ts';
import { parsePatternList } from './lib/paths.ts';
import { changedFilesFromGit, parseConfig, REPO } from './merge-gate/collect.ts';
import { REVIEWER_AGENTS } from './merge-gate/agents.ts';
import { requiredReviewers, stagingReviewers, tierOf } from './merge-gate/evaluate.ts';
import { safeName } from './lib/safe-name.ts';
import { gatedIntoStaging, taskPrs } from './batch.ts';
import { reviewPrompt } from './merge-gate/meta.ts';
import { collectScreenshots, MAX_ARTIFACT_BYTES } from './review-screenshots.ts';
import { issueFromBranch } from './merge-gate/staging.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';
import { parseVerdict } from './merge-gate/verdict.ts';

import type { Reviewer } from './merge-gate/types.ts';

type Asker = Exclude<Reviewer, 'redteam'>;

const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;
/** Each gh call that fetches CI's screenshots, the download included (#212). */
const SCREENSHOT_TIMEOUT_MS = 5 * 60 * 1000;
/** The only environment a reviewer gets: enough to run Claude Code, nothing that could carry secrets or steer it. */
const ENV_ALLOW = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
];

/**
 * Who reviews: main's rule (Argus; Cerberus when sensitive; Iris for UI once enabled), and for a PR into staging also
 * Cerberus whenever the gate's staging rule needs him: a risky area on `.github/cerberus-paths.txt`, or every PR while
 * main has no such list (#185).
 */
export function planReviewers(
  changedFiles: readonly string[],
  sensitiveList: string | null,
  config: { requireIris: boolean; uiPaths: string[] },
  pr: { base: string; cerberusList: string | null } = { base: 'main', cerberusList: null },
): Asker[] {
  const reviewers: Asker[] = requiredReviewers(
    changedFiles,
    sensitiveList === null ? null : parsePatternList(sensitiveList),
    config,
  );
  const risky =
    pr.base === 'staging' &&
    stagingReviewers(
      changedFiles,
      pr.cerberusList === null ? null : parsePatternList(pr.cerberusList),
    ).includes('cerberus');
  if (risky && !reviewers.includes('cerberus')) reviewers.splice(1, 0, 'cerberus');
  return reviewers;
}

/** Renames inside the bundle: files Claude Code could load as memory or settings, and files that hide others from search. */
export function safeTreePath(path: string): string {
  return path
    .split('/')
    .map((segment, i, all) => {
      if (/^\.claude$/i.test(segment)) return 'dot-claude';
      if (
        i === all.length - 1 &&
        /^(claude(\.local)?\.md|\.ignore|\.rgignore|\.gitignore)$/i.test(segment)
      ) {
        return `${segment}.txt`;
      }
      return segment;
    })
    .join('/');
}

export interface TreeSource {
  /** `git ls-tree -r -z --full-tree <sha>` */
  lsTree: () => string;
  /** The raw bytes of one blob. */
  blob: (sha: string) => Buffer;
}

/** A PR whose files can't be laid out safely: recorded as a block (the PR must change), never a hand review. */
export class TreeRefusal extends Error {}

/** The PR's files as regular blobs only. Nothing from git's attributes or links applies, and nothing is overwritten. */
export function exportTree(sha: string, source: TreeSource, out: string): void {
  // `original` is the PR's own path, for messages; `path` is where it lands in the bundle.
  const write = (path: string, original: string, content: () => Buffer | string) => {
    const name = `\`${safeName(original)}\``;
    const target = resolve(out, path);
    const rel = relative(out, target);
    if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
      throw new TreeRefusal(`${name} points outside the bundle`);
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'EEXIST' && code !== 'ENOTDIR') throw error; // disk or permission trouble: the run fails
      throw new TreeRefusal(
        `${name} clashes with another path in the PR (a file and a folder of one name)`,
        { cause: error },
      );
    }
    let bytes: Buffer | string;
    try {
      bytes = content();
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOBUFS') {
        throw new TreeRefusal(`${name} is too large to review`, { cause: error });
      }
      throw error;
    }
    try {
      writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EEXIST') {
        throw new TreeRefusal(
          `${name} is already in the tree: it collides with another name in the PR`,
          { cause: error },
        );
      }
      throw error;
    }
  };
  for (const entry of source.lsTree().split('\0')) {
    if (entry === '') continue;
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry);
    if (!match)
      throw new TreeRefusal(`an unreadable ls-tree entry: \`${safeName(entry.slice(0, 80))}\``);
    const [, mode, , object, path] = match as unknown as [string, string, string, string, string];
    const safe = safeTreePath(path);
    if (mode === '120000') {
      write(
        `${safe}.symlink.txt`,
        path,
        () =>
          `A symlink in the PR at ${sha.slice(0, 7)}, pointing to:\n${source.blob(object).toString('utf8')}\n`,
      );
    } else if (mode === '160000') {
      write(`${safe}.submodule.txt`, path, () => `A submodule in the PR, at commit ${object}.\n`);
    } else {
      write(safe, path, () => source.blob(object));
    }
  }
}

/** The answer from `claude -p --output-format json`; a run that didn't finish is an error, never a pass. */
export function resultText(json: string): { text: string; sessionId: string | null } {
  const out = JSON.parse(json) as {
    subtype?: unknown;
    is_error?: unknown;
    result?: unknown;
    session_id?: unknown;
  };
  if (out.is_error === true) {
    // API errors and usage limits can come back as "success" with is_error set and the reason in result.
    throw new Error(
      `the reviewer didn't finish: ${typeof out.result === 'string' ? (out.result.split('\n')[0] ?? '') : 'error'}`,
    );
  }
  if (out.subtype !== 'success' || typeof out.result !== 'string') {
    throw new Error(`the reviewer didn't finish (${String(out.subtype)})`);
  }
  return {
    text: out.result,
    sessionId: typeof out.session_id === 'string' ? out.session_id : null,
  };
}

export function reviewerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => ENV_ALLOW.includes(key))),
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false', // no claude.ai connectors in a reviewer's session
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', // no notes from earlier sessions: each review starts from the bundle alone
  };
}

export interface BundleDeps {
  gh: (args: string[]) => string;
  git: (args: string[]) => string;
  blob: (sha: string) => Buffer;
  now: () => number;
  /** CI's screenshots on the head commit into a folder; returns screenshots.txt (#212). */
  screenshots: (sha: string, into: string) => string;
}

export interface Bundle {
  bundle: string;
  outDir: string;
  sha: string;
  /** The PR's base branch (`staging` or `main`), which decides who reviews (#185). */
  base: string;
  changed: string[];
  /** Why the PR's files couldn't be laid out safely (a name collision, an unreadable entry, a huge blob), or null. */
  refusal: string | null;
}

/**
 * One issue for issues.md: its title and body, then its comments with author and date, where Zeus's decisions are
 * recorded (#116).
 */
function issueText(number: number, json: string): string {
  const issue = JSON.parse(json) as {
    title: string;
    body: string;
    comments: { author: { login: string } | null; createdAt: string; body: string }[];
  };
  const comments = issue.comments.map(
    (c) => `### ${c.author?.login ?? 'unknown'}, ${c.createdAt}\n\n${c.body}`,
  );
  return [
    `# Issue #${String(number)}\n\n${issue.title}\n\n${issue.body}`,
    `## Comments on #${String(number)}`,
    comments.length > 0 ? comments.join('\n\n') : 'None.',
  ].join('\n\n');
}

export function buildBundle(pr: number, deps: BundleDeps, stateDir = STATE_DIR): Bundle {
  const { gh, git } = deps;
  // One read: the head, the PR text and the base the bundle is built against come from the same moment, so a PR
  // retargeted mid-way can't mix two states (Argus and Cerberus on #104). Compared with the PR's own base: once staging
  // holds work main doesn't, a diff against main would show it as this PR's (#103). changedFilesFromGit refuses any
  // base but main and staging, and fetches staging when it's the base.
  const snapshotJson = gh([
    'pr',
    'view',
    String(pr),
    '-R',
    REPO,
    '--json',
    'headRefOid,body,baseRefName,headRefName',
  ]);
  const snapshot = JSON.parse(snapshotJson) as {
    headRefOid: string;
    body: string;
    baseRefName: string;
    headRefName: string;
  };
  const sha = snapshot.headRefOid;
  const base = snapshot.baseRefName;
  const branch = snapshot.headRefName;
  const changed = changedFilesFromGit(git, pr, sha, base);

  const stamp = `${sha.slice(0, 7)}-${String(deps.now())}`;
  const bundle = join(stateDir, 'bundles', `pr-${String(pr)}`, stamp);
  const outDir = join(stateDir, 'bundles', `pr-${String(pr)}`, 'out', stamp);
  mkdirSync(join(bundle, 'tree'), { recursive: true, mode: 0o700 });
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(bundle, 'snapshot.json'), snapshotJson);
  writeFileSync(join(bundle, 'pr.md'), snapshot.body);
  let refusal: string | null = null;
  try {
    exportTree(
      sha,
      { lsTree: () => git(['ls-tree', '-r', '-z', '--full-tree', sha]), blob: deps.blob },
      join(bundle, 'tree'),
    );
  } catch (error) {
    if (!(error instanceof TreeRefusal)) throw error; // disk or git trouble: the run fails, nothing is recorded
    refusal = error.message;
  }
  // Files git treats as binary: their bytes in diff.patch mean little, so reviewers open them in tree/.
  const binaries = git(['diff', '--numstat', '-z', '--no-renames', `origin/${base}...${sha}`])
    .split('\0')
    .filter((line) => line.startsWith('-\t-\t'))
    .map((line) => safeName(line.slice(4))); // one printable line each: a name can't add lines
  writeFileSync(
    join(bundle, 'binary.txt'),
    binaries.length ? binaries.join('\n') : 'No binary files.',
  );
  // --text: a stray NUL byte must not hide a file's code behind "Binary files differ".
  writeFileSync(join(bundle, 'diff.patch'), git(['diff', '--text', `origin/${base}...${sha}`]));
  writeFileSync(
    join(bundle, 'history.patch'),
    git(['log', '--reverse', '-p', '--cc', '--text', `origin/${base}..${sha}`]),
  );

  const prefix = `https://github.com/${REPO}/issues/`;
  // GitHub links "Closes #n" only for PRs into the default branch: a PR into staging gets its task issue from the branch
  // name, as the merge gate reads it.
  const stagingIssue = base === 'staging' ? issueFromBranch(branch) : null;
  const references =
    base === 'staging'
      ? stagingIssue === null
        ? []
        : [{ number: stagingIssue, url: `${prefix}${String(stagingIssue)}` }]
      : (
          JSON.parse(
            gh(['pr', 'view', String(pr), '-R', REPO, '--json', 'closingIssuesReferences']),
          ) as { closingIssuesReferences: { number: number; url: string }[] }
        ).closingIssuesReferences;
  const issues = references.map(({ number, url }) =>
    url.startsWith(prefix)
      ? issueText(
          number,
          gh(['issue', 'view', String(number), '-R', REPO, '--json', 'title,body,comments']),
        )
      : `# #${String(number)} is in another repository (${url}): not part of this review.`,
  );
  writeFileSync(join(bundle, 'issues.md'), issues.join('\n\n') || 'This PR closes no issue.');

  let checks: string;
  try {
    checks = gh(['pr', 'checks', String(pr), '-R', REPO]);
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: unknown; stderr?: unknown };
    checks = [
      'Not every check is green, or gh failed:',
      typeof stdout === 'string' ? stdout : '',
      typeof stderr === 'string' ? stderr : '',
    ].join('\n');
  }
  writeFileSync(join(bundle, 'ci.txt'), checks);
  // The screens the PR renders, so Iris can see them (#212).
  writeFileSync(
    join(bundle, 'screenshots.txt'),
    deps.screenshots(sha, join(bundle, 'screenshots')),
  );
  const reviewComments = gh([
    'api',
    `repos/${REPO}/pulls/${String(pr)}/comments`,
    '--paginate',
    '--jq',
    '.[] | {user: .user.login, path, line, body}',
  ])
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
  const conversation = JSON.parse(
    gh(['pr', 'view', String(pr), '-R', REPO, '--json', 'comments,reviews']),
  ) as unknown;
  writeFileSync(
    join(bundle, 'comments.json'),
    JSON.stringify({ conversation, reviewComments }, null, 2),
  );
  if (base === 'main' && branch === 'staging') {
    // A batch: the gate squash-merges each task PR into staging, so history.patch shows one commit per task (#132).
    const subjects = git(['log', '--first-parent', '--format=%s', `origin/${base}..${sha}`]);
    writeFileSync(
      join(bundle, 'tasks.md'),
      taskHistory(taskPrs(subjects), gh, gatedIntoStaging(stateDir)),
    );
  }
  return { bundle, outDir, sha, base, changed, refusal };
}

/**
 * tasks.md for a batch (#132): each task PR's own commits from GitHub, in parent-link order (not GitHub's list order,
 * which can follow dates a builder sets), with the files each one touched, so reviewers can see each task's tests came
 * before its code. A merge is checked: if its other parents are on `staging` or `main` it's an update from the base,
 * and only the files that differ from every parent are listed (git's combined diff), since only those can hold code
 * added in the merge itself; otherwise it's listed with all its files and a warning. Titles, subjects and file names
 * are the builder's: one printable line each. A failed `gh` call stops the run; a reply that can't be read marks its
 * task with a fixed reason. Reviewers have no GitHub access, so every gap tells them to block.
 */
export function taskHistory(
  prs: readonly number[],
  gh: (args: string[]) => string,
  gated: ReadonlySet<number>,
): string {
  const BLOCK = "reviewers can't see the rest, so block until Athena lists them";
  const inBase = (commit: string) =>
    ['staging', 'main'].some((base) =>
      ['behind', 'identical'].includes(
        gh(['api', `repos/${REPO}/compare/${base}...${commit}`, '--jq', '.status']).trim(),
      ),
    );
  // `--slurp` puts every page in one array.
  const pages = (path: string) => read(gh(['api', path, '--paginate', '--slurp'])) as unknown[];
  const names = (list: unknown[]) => [
    ...new Set(
      (list as { files?: { filename: string }[] }[]).flatMap((page) =>
        (page.files ?? []).map(({ filename }) => filename),
      ),
    ),
  ];
  // GitHub pages a commit's files (300 a page) against its first parent and stops at 3000; a comparison stops at 300.
  const filesOf = (commit: string) => names(pages(`repos/${REPO}/commits/${commit}`));
  const filesSince = (parent: string, commit: string) =>
    names(pages(`repos/${REPO}/compare/${parent}...${commit}`));
  const task = (pr: number): string => {
    const { title } = read(gh(['pr', 'view', String(pr), '-R', REPO, '--json', 'title'])) as {
      title: string;
    };
    const listed = (
      pages(`repos/${REPO}/pulls/${String(pr)}/commits?per_page=100`) as unknown[][]
    ).flat() as { sha: string; parents: { sha: string }[]; commit: { message: string } }[];
    // GitHub stops a PR's commit list at 250, whatever the paging. A PR has at least one commit.
    const reply = gh(['api', `repos/${REPO}/pulls/${String(pr)}`, '--jq', '.commits']).trim();
    const count = Number(reply);
    if (reply === '' || !Number.isInteger(count) || count < 1) throw new UnreadableReply();
    const notes = [
      ...(gated.has(pr) ? [] : [' (not merged into staging by the gate: unverified)']),
    ];
    const list = (files: string[]) => files.map((name) => `\`${safeName(name)}\``).join(', ');
    // A merge from the base: only the files that differ from every parent can hold code added in the merge itself.
    const baseMerge = (sha: string, others: string[], files: string[], capped: string) => {
      const since = others.map((parent) => filesSince(parent, sha));
      const own = files.filter((name) => since.every((other) => other.includes(name)));
      const warnings = `${capped}${
        since.some((other) => other.length >= 300)
          ? ` (GitHub compares at most 300 files: ${BLOCK})`
          : ''
      }`;
      return own.length === 0
        ? ` (a merge from the base; no file differs from every parent)${warnings}`
        : ` (a merge from the base; these files differ from every parent: check them for code added in the merge)${warnings} — ${list(own)}`;
    };
    const lines = parentOrder(listed).map(({ sha, parents, commit }) => {
      const head = `- \`${sha.slice(0, 7)}\` ${safeName(commit.message.split('\n')[0] ?? '')}`;
      const files = filesOf(sha);
      const capped =
        files.length >= 3000 ? ` (GitHub lists only a commit's first 3000 files: ${BLOCK})` : '';
      const others = parents.slice(1).map(({ sha: parent }) => parent);
      if (others.length > 0 && others.every(inBase))
        return `${head}${baseMerge(sha, others, files, capped)}`;
      const warning = `${others.length > 0 ? ' (a merge NOT from the base: check it)' : ''}${capped}`;
      return files.length === 0 ? `${head}${warning}` : `${head}${warning} — ${list(files)}`;
    });
    const short =
      listed.length < count
        ? [
            `Only ${String(listed.length)} of PR #${String(pr)}'s ${String(count)} commits are listed (GitHub's limit): ${BLOCK}.`,
            '',
          ]
        : [];
    return [
      `## PR #${String(pr)}: ${safeName(title)}${notes.join('')}`,
      '',
      ...short,
      ...lines,
    ].join('\n');
  };
  const sections = prs.map((pr) => {
    try {
      return task(pr);
    } catch (error) {
      // Only a reply that can't be read is marked here, with a fixed reason (never the command line); a failed gh call
      // (a rate limit, auth, the network) stops the run, so no bundle goes out with a task missing.
      if (!(error instanceof UnreadableReply)) throw error;
      return `## PR #${String(pr)}\n\nCouldn't list PR #${String(pr)}'s commits: GitHub's reply couldn't be read. Reviewers can't see them, so block until Athena lists them.`;
    }
  });
  return [
    "# The batch's task PRs, each with its own commits (oldest first, by parent links)",
    '',
    'The gate squash-merges each task PR into `staging`, so `history.patch` shows one commit per task. These are the',
    "task PRs' own commits, as GitHub lists them, put in order by their parent links.",
    '',
    ...sections.flatMap((section) => [section, '']),
  ].join('\n');
}

/** A GitHub reply tasks.md can't read: its task is marked, the rest of the batch is still listed. */
class UnreadableReply extends Error {}

function read(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UnreadableReply();
  }
}

/** Commits in parent-link order: each after every parent of it in the list; ties keep the list's order. */
function parentOrder<T extends { sha: string; parents: { sha: string }[] }>(
  commits: readonly T[],
): T[] {
  const inList = new Set(commits.map(({ sha }) => sha));
  const placed = new Set<string>();
  const ordered: T[] = [];
  while (ordered.length < commits.length) {
    const next = commits.find(
      ({ sha, parents }) =>
        !placed.has(sha) &&
        parents.every(({ sha: parent }) => !inList.has(parent) || placed.has(parent)),
    );
    if (next === undefined) throw new Error("the task PR's commits have a parent loop");
    placed.add(next.sha);
    ordered.push(next);
  }
  return ordered;
}

export interface ReviewDeps {
  /** Runs `claude` with these arguments, environment and timeout; returns its JSON output. */
  claude: (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => string | Promise<string>;
  /** A file from main (`git show HEAD:`), or null. */
  show: (path: string) => string | null;
  /** Runs record-review.ts with these arguments. */
  record: (args: string[]) => string;
  write: (path: string, text: string) => void;
  /** Notes a review that needed a retry (#158), for the weekly report. */
  logRetry?: (entry: {
    pr: number;
    reviewer: Asker;
    first: string | null;
    second: string | null;
    /** The first answer's hash, to audit it without its transcript (Cerberus F3 on #165). */
    firstSha256: string;
  }) => void;
  env: NodeJS.ProcessEnv;
}

/**
 * A malformed answer worth asking again (#158): its first line isn't the verdict, and nowhere in it is there a block
 * signal (a `VERDICT … block` line, a `[blocking]` finding, Cerberus's should-fix), as verdict.ts reads them. Anything
 * that signals a block is recorded as it is, a block, so a retry can never turn a block into a pass. verdict.ts's rules
 * don't change.
 */
export function retryWorthy(summary: string, reviewer: Asker): boolean {
  const lines = summary.split(/\r\n?|\n/);
  const first = lines.find((line) => line.trim() !== '' && !/^`{3,}\w*$/.test(line.trim()));
  if (first !== undefined && /^VERDICT: (?:pass|block)$/.test(first.trim())) return false;
  // The whole answer read as if it followed a pass, so verdict.ts finds a block signal anywhere in it, above the verdict
  // line or below (Argus F1, Cerberus F1 on #165). An answer with no verdict line and no block signal is retried too.
  return parseVerdict(`VERDICT: pass\n${summary}`, reviewer).verdict === 'pass';
}

/** The reason a reviewer run failed, from its output: never the command line, which holds local paths. */
function failureReason(error: unknown): string {
  const { stderr, stdout, signal } = error as {
    stderr?: unknown;
    stdout?: unknown;
    signal?: unknown;
  };
  if (signal === 'SIGTERM') return 'it timed out';
  for (const text of [stdout, stderr]) {
    if (typeof text !== 'string' || text.trim() === '') continue;
    try {
      const out = JSON.parse(text) as { subtype?: unknown; is_error?: unknown; result?: unknown };
      if (out.is_error === true && typeof out.result === 'string')
        return out.result.split('\n')[0] ?? 'error';
      if (typeof out.subtype === 'string') return out.subtype;
    } catch {
      // not JSON: take its first line
    }
    return text.trim().split('\n')[0]?.slice(0, 200) ?? 'unknown';
  }
  if (error instanceof Error) {
    return error.message.startsWith('Command failed')
      ? 'the claude command failed'
      : (error.message.split('\n')[0] ?? 'unknown');
  }
  return 'unknown';
}

/**
 * The model a reviewer runs on, or null for its agent file's (Opus). Zeus, 2026-11-12 (token budget): Argus and Iris
 * review on Sonnet at every tier; Cerberus, the security review, stays on Opus.
 */
export function reviewerModel(reviewer: Asker): string | null {
  return reviewer === 'cerberus' ? null : 'claude-sonnet-5-5';
}

/**
 * Runs every reviewer at once (Zeus, 2026-11-08: a round takes as long as the slowest reviewer, not their sum) and
 * records each verdict as it finishes; returns how many reviewers failed to run or record.
 */
export async function runReviews(
  pr: number,
  where: { bundle: string; outDir: string; refusal: string | null },
  reviewers: readonly Asker[],
  deps: ReviewDeps,
): Promise<number> {
  // allSettled: one reviewer throwing still lets the others finish and record, and counts as one failure.
  const results = await Promise.allSettled(reviewers.map((reviewer) => reviewOne(reviewer)));
  return results.reduce((sum, r, i) => {
    if (r.status === 'fulfilled') return sum + r.value;
    console.error(
      `${reviewers[i] ?? 'a reviewer'} failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}. Nothing recorded for it; run it again.`,
    );
    return sum + 1;
  }, 0);

  async function reviewOne(reviewer: Asker): Promise<number> {
    let failed = 0;
    const agent = REVIEWER_AGENTS[reviewer];
    const model = reviewerModel(reviewer);
    let summary: string;
    let sessionId: string | null = null;
    if (where.refusal !== null) {
      // The PR's files couldn't be laid out safely: the PR must change, so this commit is blocked.
      summary = `VERDICT: block\n[blocking] ${where.refusal} — rename or remove it so the files can be reviewed`;
    } else if (deps.show(`.claude/agents/${agent}.md`) === null) {
      summary = `VERDICT: block\n[blocking] .claude/agents/${agent}.md — main has no ${agent} agent file — add it before PRs need ${reviewer}`;
    } else {
      try {
        const ask = async () =>
          resultText(
            await deps.claude(
              [
                '-p',
                '--agent',
                agent,
                ...(model === null ? [] : ['--model', model]),
                '--add-dir',
                where.bundle,
                '--disallowedTools',
                'Read(**/.env*)',
                'mcp__*',
                '--setting-sources',
                'project',
                '--strict-mcp-config',
                '--permission-mode',
                'dontAsk',
                '--max-turns',
                '40',
                '--output-format',
                'json',
                reviewPrompt(reviewer, where.bundle),
              ],
              reviewerEnv(deps.env),
              REVIEW_TIMEOUT_MS,
            ),
          );
        let out = await ask();
        if (retryWorthy(out.text, reviewer)) {
          // One fresh session; its answer is recorded as it comes, well-formed or not (#158).
          console.error(
            `${reviewer}'s answer had a line before its verdict: asking once more in a fresh session.`,
          );
          const first = out;
          let second: typeof out | undefined;
          try {
            second = await ask();
          } finally {
            // Logged whether or not the second session finishes (Argus F6 on #165).
            deps.logRetry?.({
              pr,
              reviewer,
              first: first.sessionId,
              second: second?.sessionId ?? null,
              firstSha256: createHash('sha256').update(first.text).digest('hex'),
            });
          }
          out = second;
        }
        summary = out.text;
        sessionId = out.sessionId;
      } catch (error) {
        // A run that didn't finish records nothing: the gate already refuses without a pass, and a retry can pass.
        console.error(
          `${reviewer} didn't finish: ${failureReason(error)}. Nothing recorded; run it again.`,
        );
        return 1;
      }
    }
    const file = join(where.outDir, `${reviewer}.md`);
    const meta = join(where.outDir, `${reviewer}.meta.json`);
    deps.write(file, `${summary}\n`);
    deps.write(meta, JSON.stringify({ agent, sessionId }));
    try {
      console.log(
        deps
          .record([
            String(pr),
            reviewer,
            file,
            '--snapshot',
            join(where.bundle, 'snapshot.json'),
            '--meta',
            meta,
          ])
          .trim(),
      );
    } catch (error) {
      failed++;
      console.error(
        `Recording ${reviewer} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.log(summary.split('\n')[0]);
    return failed;
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main(argv: string[]): Promise<number> {
  const pr = Number(argv.find((a) => !a.startsWith('--')));
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error('usage: node scripts/review.ts <pr> [--dry-run]');
    return 2;
  }
  assertCleanMain(run);
  const show = (path: string) => readMainFile(run, path);
  const where = buildBundle(pr, {
    gh: (args) => run('gh', args),
    git: (args) => run('git', args),
    blob: (object) =>
      execFileSync('git', ['cat-file', 'blob', object], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }),
    now: () => Date.now(),
    // A time limit on each call, and the zip comes back as bytes, at most the artifact limit, never unpacked on disk:
    // the PR's code decides what its artifacts hold (Cerberus F1 on #213).
    screenshots: (sha, into) =>
      collectScreenshots(sha, into, {
        gh: (args) =>
          execFileSync('gh', args, {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: SCREENSHOT_TIMEOUT_MS,
          }),
        fetchZip: (artifactId) =>
          execFileSync('gh', ['api', `repos/${REPO}/actions/artifacts/${String(artifactId)}/zip`], {
            cwd: ROOT,
            maxBuffer: MAX_ARTIFACT_BYTES + 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: SCREENSHOT_TIMEOUT_MS,
          }),
      }),
  });
  const sensitiveList = show('.github/sensitive-paths.txt');
  const reviewers = planReviewers(
    where.changed,
    sensitiveList,
    parseConfig(show('.github/merge-gate.json')),
    { base: where.base, cerberusList: show('.github/cerberus-paths.txt') },
  );
  const tier = tierOf(
    where.changed,
    sensitiveList === null ? null : parsePatternList(sensitiveList),
  );
  console.log(
    `PR #${String(pr)} at ${where.sha.slice(0, 7)} (${tier}): bundle ${where.bundle}; reviewers ${reviewers.map((r) => `${r}${reviewerModel(r) === null ? '' : ' on Sonnet'}`).join(', ')}`,
  );
  if (argv.includes('--dry-run')) return 0;
  const failed = await runReviews(pr, where, reviewers, {
    // Not blocking, so every reviewer's session runs at the same time. stdin is closed, as before.
    claude: async (args, env, timeoutMs) => {
      const run = promisify(execFile)('claude', args, {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      run.child.stdin?.end();
      return (await run).stdout;
    },
    show,
    record: (args) => run('node', [join(ROOT, 'scripts/record-review.ts'), ...args]),
    write: (path, text) => {
      writeFileSync(path, text, { mode: 0o600 });
    },
    logRetry: (entry) => {
      mkdirSync(join(STATE_DIR, 'logs'), { recursive: true, mode: 0o700 });
      appendFileSync(
        join(STATE_DIR, 'logs', 'review-retries.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
        { mode: 0o600 },
      );
    },
    env: process.env,
  });
  return failed === 0 ? 0 : 1;
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`review error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
