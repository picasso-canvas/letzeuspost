// Picasso's instance on Zeus's Mac (§18, #81): the pieces of `scripts/picasso.ts` that decide something, kept apart
// so they can be tested without Docker, GitHub or a terminal.
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
  /** Where Zeus said yes, from `--zeus-ok`; undefined means ask him at the terminal. */
  zeusOk: string | undefined;
}

/** `deploy <commit> [--zeus-ok "<where he said it>"]`, or the reason it can't be read. */
export function parseDeployArgs(argv: readonly string[]): DeployArgs | string {
  let commit: string | undefined;
  let zeusOk: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--zeus-ok') {
      zeusOk = argv[++i];
      if (zeusOk === undefined || zeusOk.trim().length < 8) {
        return '--zeus-ok needs where Zeus said yes (his message, or a link to it), at least 8 characters.';
      }
    } else if (arg.startsWith('-') || commit !== undefined) {
      return `Unexpected argument ${arg}. Usage: picasso.ts deploy <main commit> [--zeus-ok "<where Zeus said yes>"]`;
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

/** Why a commit's checks aren't all green (naming each one that isn't), or undefined when they are. */
export function checksProblem(runs: readonly CheckRun[]): string | undefined {
  if (runs.length === 0) return 'the commit has no checks, so nothing shows it is green';
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
