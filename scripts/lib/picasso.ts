// Picasso's instance on Zeus's Mac (§18, #81): the pieces of `scripts/picasso.ts` that decide something, kept apart
// so they can be tested without Docker, GitHub or a terminal.
import { cpSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** The Compose project's name: its own containers, volumes and `*.orb.local` addresses. */
export const PROJECT = 'letzeuspost-picasso';
/** Where OrbStack serves the web app: `<service>.<project>.orb.local`, over https. */
export const APP_URL = `https://web.${PROJECT}.orb.local`;

/** The folder with the instance's `.env`, backups and deploy log. It must lie outside every checkout and clone. */
export function instanceDir(
  env: Readonly<Record<string, string | undefined>>,
  home: string = homedir(),
): string {
  const given = env.LZP_PICASSO_DIR;
  return given !== undefined && given !== '' ? resolve(given) : join(home, 'letzeuspost-picasso');
}

/** Why `dir` can't hold the instance's secrets (it lies inside a checkout or a builder's clone), or undefined. */
export function dirProblem(dir: string, repoRoot: string, buildersDir: string): string | undefined {
  for (const [what, outer] of [
    ['this checkout', repoRoot],
    ["the builders' clones", buildersDir],
  ] as const) {
    const path = relative(outer, dir);
    if (path === '' || (!path.startsWith('..') && !isAbsolute(path))) {
      return `${dir} is inside ${what}: the instance's .env must live outside every repo checkout and builder clone.`;
    }
  }
  return undefined;
}

/** `text` made safe to sit inside an XML element (the launchd plist). */
export function xmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** The text of the instance's `.env`: every setting the four processes read, with a fresh secret for each. */
export function picassoEnvText(randomBytes: (size: number) => Uint8Array): string {
  const secret = () => Buffer.from(randomBytes(24)).toString('hex'); // 48 hex characters: safe inside a URL
  const key = () => Buffer.from(randomBytes(32)).toString('base64');
  const owner = secret();
  const app = secret();
  const lines = [
    "# Picasso's instance (scripts/picasso.ts init). Never commit it, never share it, never put it in a checkout.",
    'LZP_ENV=development', // Zeus's Mac (§14): plain http addresses are allowed inside the project
    `LZP_PG_SUPERUSER_PASSWORD=${secret()}`,
    `LZP_PG_OWNER_PASSWORD=${owner}`,
    `LZP_PG_APP_PASSWORD=${app}`,
    `DATABASE_URL=postgres://lzp_app:${app}@postgres:5432/letzeuspost`,
    `DATABASE_OWNER_URL=postgres://lzp_owner:${owner}@postgres:5432/letzeuspost`,
    'STORAGE_ENDPOINT=http://storage:8333',
    'STORAGE_REGION=us-east-1',
    'STORAGE_BUCKET=letzeuspost-picasso',
    'STORAGE_ACCESS_KEY_ID=lzp-picasso',
    `STORAGE_SECRET_ACCESS_KEY=${secret()}`,
    'SMTP_URL=smtp://mail:1025',
    'EMAIL_FROM=noreply@letzeuspost.invalid',
    `AUTH_SECRET=${key()}`,
    `APP_URL=${APP_URL}`,
    `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${key()}`,
  ];
  return `${lines.join('\n')}\n`;
}

export interface DeployArgs {
  /** The commit given on the command line (not yet checked against main). */
  commit: string;
  /** The posted record of Zeus's yes (a GitHub comment URL), from `--zeus-ok`; undefined means ask him at the terminal. */
  zeusOk: string | undefined;
}

/** The id of the issue or pull request comment a URL points at, or undefined when it isn't one. */
export function commentId(url: string): string | undefined {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(
    url,
  )?.[1];
}

export interface Comment {
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  user: { login: string };
}

/**
 * Why a comment is not the posted record of Zeus's yes to deploying `commit` (§19 #116: his decision counts as a
 * posted record, "Zeus decided (<date>, in chat): …"), or undefined when it is. It must be this repository's, by the
 * signed-in GitHub user (Athena posts it as that user), begin "Zeus decided (<date>, in chat): deploy <commit>" with the
 * commit's first 7 or more characters, never have been edited, and be newer than the commit, so an older yes never
 * covers a newer commit.
 */
export function approvalProblem(
  comment: Comment,
  commit: string,
  committedAt: string,
  login: string,
  repo: string,
): string | undefined {
  if (!comment.html_url.startsWith(`https://github.com/${repo}/`))
    return `the comment is not in ${repo}`;
  if (comment.user.login !== login)
    return `the comment is by ${comment.user.login}, not by ${login}`;
  // The whole record format, not words somewhere in the text: "do not deploy …" or a quoted record must not count.
  const named = /^Zeus decided \(\d{4}-\d{2}-\d{2}, in chat\): deploy ([0-9a-f]{7,40})\b/.exec(
    comment.body.trim(),
  )?.[1];
  if (named === undefined) {
    return 'the comment is not a record of the form "Zeus decided (<date>, in chat): deploy <commit> …"';
  }
  if (!commit.toLowerCase().startsWith(named)) {
    return `the comment is a yes to ${named}, not to the commit ${commit.slice(0, 7)}`;
  }
  if (comment.updated_at !== comment.created_at) {
    return 'the comment was edited after it was posted: post a new record';
  }
  if (Date.parse(comment.created_at) <= Date.parse(committedAt)) {
    return 'the comment is older than the commit, so it is not a yes to it';
  }
  return undefined;
}

/** `deploy <commit> [--zeus-ok "<where he said it>"]`, or the reason it can't be read. */
export function parseDeployArgs(argv: readonly string[]): DeployArgs | string {
  let commit: string | undefined;
  let zeusOk: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--zeus-ok') {
      zeusOk = argv[++i];
      if (zeusOk === undefined || commentId(zeusOk.trim()) === undefined) {
        return '--zeus-ok needs the posted record of his yes: the URL of an issue or pull request comment (https://github.com/<owner>/<repo>/issues/<n>#issuecomment-<id>).';
      }
    } else if (arg.startsWith('-') || commit !== undefined) {
      return `Unexpected argument ${arg}. Usage: picasso.ts deploy <main commit> [--zeus-ok <comment URL>]`;
    } else {
      commit = arg;
    }
  }
  if (commit === undefined || !/^[0-9a-f]{7,40}$/i.test(commit)) {
    return 'Give the main commit to deploy, as a 7 to 40 character hex sha.';
  }
  return { commit, zeusOk: zeusOk?.trim() };
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface MergedPull {
  number: number;
  merge_commit_sha: string | null;
  merged_at: string | null;
  head: { sha: string };
  base: { ref: string };
}

/**
 * The head commit of the pull request that put `commit` on main. The workflows run on pull requests only (a push to
 * main would re-check a tree already checked, ci.yml), so a main commit has no checks of its own: the ones that count
 * are those on the head of the PR it came from, which the merge gate required green before the merge.
 */
export function mergedHead(pulls: readonly MergedPull[], commit: string): MergedPull | undefined {
  return pulls.find(
    (pull) =>
      pull.merged_at !== null && pull.base.ref === 'main' && pull.merge_commit_sha === commit,
  );
}

/**
 * Why a commit's checks aren't all green (naming each one that isn't), or undefined when they are. `required` is the
 * merge gate's own list (`.github/merge-gate.json` on main): each must be among the runs, so an unrelated green check
 * can't stand in for them.
 */
export function checksProblem(
  runs: readonly CheckRun[],
  required: readonly string[],
): string | undefined {
  if (runs.length === 0) return 'the commit has no checks, so nothing shows it is green';
  if (required.length === 0) return "the gate's list of required checks is empty";
  const missing = required.filter((name) => !runs.some((run) => run.name === name));
  if (missing.length > 0) return `these required checks never ran: ${missing.join(', ')}`;
  const bad = runs.filter(
    (run) =>
      run.status !== 'completed' ||
      !['success', 'skipped', 'neutral'].includes(run.conclusion ?? ''),
  );
  if (bad.length === 0) return undefined;
  return `these checks are not green: ${bad
    .map(
      (run) => `${run.name} (${run.status === 'completed' ? (run.conclusion ?? '?') : run.status})`,
    )
    .join(', ')}`;
}

/** The image tag for a commit: its first 12 characters, which the compose file and the deploy id both use. */
export function imageTag(commit: string): string {
  return commit.slice(0, 12).toLowerCase();
}

/**
 * The `docker run` arguments of the sandbox check on a freshly built worker image (#383): the options the compose file
 * gives the worker (the profile, no new privileges, no capability), and no network, which the check doesn't need.
 */
export function sandboxCheckArgs(tag: string, seccompProfile: string): string[] {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--security-opt',
    `seccomp=${seccompProfile}`,
    '--security-opt',
    'no-new-privileges:true',
    '--cap-drop',
    'ALL',
    `lzp-picasso-worker:${tag}`,
    'node',
    'packages/render/src/browser/check-sandbox.ts',
  ];
}

/** The instance keeps its own copy of the build's `docker/` at `<current>/docker`, an older copy replaced (a `cp -R` of a
 *  folder onto one that exists nests it one level deeper, which is how the first deploy found it, #396). */
export function keepDockerFolder(source: string, current: string): void {
  rmSync(current, { recursive: true, force: true });
  cpSync(join(source, 'docker'), join(current, 'docker'), { recursive: true });
}
