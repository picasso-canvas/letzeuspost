#!/usr/bin/env node
// Dispatch (§19 step 3, #32): starts one builder on one build task.
//   node scripts/dispatch.ts <issue> [--findings <file>] [--max-turns <n>] [--dry-run]
// It runs from a clean `main`. The builder gets a fresh clone (never a worktree: a worktree shares .git hooks and
// settings with this checkout) with no remote, the task in .lzp/task.md, and a headless Claude Code session with
// main's builder settings (sandbox on), LZP_ROLE=builder, LZP_HARNESS_DIR, no GitHub credential (no GH_TOKEN, an
// empty gh config, git credential helpers off) and no Docker socket. pnpm's store, cache and state live in the
// clone. While it runs, the repo variable AGENTS_PAUSED is copied into ~/.letzeuspost/paused every minute, with the
// time, for the hooks (#29): builders can't reach GitHub to read it. Services (database, storage, mail) arrive in M0.
import { execFileSync, spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCleanMain } from './lib/clean-main.ts';
import { parseRawDiff, shipRefusals } from './lib/protected.ts';
import { REPO } from './merge-gate/collect.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';
import { BUILDERS_DIR } from './ship.ts';

/** `[M0] Sign-in with an email link` → `sign-in-with-an-email-link`, at most 40 characters. */
export function slugify(title: string): string {
  const slug = title
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug === '' ? 'task' : slug;
}

/** The freeze flag the hooks read: paused unless the variable says exactly "false". */
export function freezeFlag(variable: string | null, now: Date): string {
  return `${JSON.stringify({ paused: variable?.trim().toLowerCase() !== 'false', at: now.toISOString(), source: 'AGENTS_PAUSED' })}\n`;
}

export function taskText(
  issue: number,
  title: string,
  body: string,
  findings: string | null,
): string {
  const parts = [`# Task #${String(issue)}: ${title}`, '', body.trim()];
  if (findings !== null)
    parts.push('', '## Review findings to fix (from Athena)', '', findings.trim());
  return `${parts.join('\n')}\n`;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLAG = join(STATE_DIR, 'paused');

function run(cmd: string, args: string[], cwd = ROOT): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readVariable(): string | null {
  try {
    return run('gh', ['variable', 'get', 'AGENTS_PAUSED', '-R', REPO]);
  } catch {
    return null;
  }
}

function refreshFlag(): boolean {
  const variable = readVariable();
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FLAG, freezeFlag(variable, new Date()), { mode: 0o644 });
  return variable?.trim().toLowerCase() === 'false';
}

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const issue = Number(argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')));
  if (!Number.isInteger(issue) || issue <= 0) {
    console.error(
      'usage: node scripts/dispatch.ts <issue> [--findings <file>] [--max-turns <n>] [--dry-run]',
    );
    return 2;
  }
  assertCleanMain((cmd, args) => run(cmd, args));
  if (!refreshFlag()) {
    console.error('Frozen: AGENTS_PAUSED is not "false". Nothing was started.');
    return 1;
  }

  const view = JSON.parse(
    run('gh', ['issue', 'view', String(issue), '-R', REPO, '--json', 'title,body,state,labels']),
  ) as { title: string; body: string; state: string; labels: { name: string }[] };
  if (view.state !== 'OPEN' || !view.labels.some((l) => l.name === 'build-task')) {
    console.error(`#${String(issue)} isn't an open build-task issue.`);
    return 1;
  }
  const branch = `${String(issue)}-${slugify(view.title)}`;
  const clone = join(BUILDERS_DIR, branch);

  // A branch that already exists (a review round) must not differ from main on any protected path: its .claude/
  // would load in the builder's session.
  let base = 'origin/main';
  const remote = run('git', ['ls-remote', '--heads', 'origin', branch]).trim();
  if (remote !== '') {
    const ref = `refs/lzp/dispatch-${String(issue)}`;
    run('git', [
      '-c',
      'core.hooksPath=/dev/null',
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      `+refs/heads/${branch}:${ref}`,
    ]);
    const refusals = shipRefusals(
      parseRawDiff(
        run('git', ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `origin/main...${ref}`]),
      ),
    ).filter((reason) => reason !== 'the branch changes nothing');
    if (refusals.length > 0) {
      console.error(`Refused: ${branch} changes protected paths:\n- ${refusals.join('\n- ')}`);
      return 1;
    }
    base = ref;
  }
  const findingsFile = option(argv, '--findings');
  const task = taskText(
    issue,
    view.title,
    view.body,
    findingsFile ? readFileSync(findingsFile, 'utf8') : null,
  );
  console.log(
    `#${String(issue)} → ${clone} on ${branch} (from ${base === 'origin/main' ? 'main' : 'the existing branch'})`,
  );
  if (argv.includes('--dry-run')) return 0;

  // A fresh clone every time: nothing a builder left behind (untracked files, node_modules) carries over.
  if (existsSync(clone)) rmSync(clone, { recursive: true, force: true });
  mkdirSync(BUILDERS_DIR, { recursive: true, mode: 0o700 });
  run(
    'git',
    ['clone', '--quiet', '--no-hardlinks', '-c', 'core.hooksPath=/dev/null', ROOT, clone],
    BUILDERS_DIR,
  );
  const baseSha = run('git', ['rev-parse', base]).trim();
  // By ref name: a local clone may refuse to fetch a bare commit id.
  const baseRef = base === 'origin/main' ? 'refs/heads/main' : base;
  run(
    'git',
    ['fetch', '--quiet', '--no-tags', 'origin', `+${baseRef}:refs/heads/${branch}`],
    clone,
  );
  run('git', ['checkout', '--quiet', branch], clone);
  if (run('git', ['rev-parse', 'HEAD'], clone).trim() !== baseSha)
    throw new Error('the clone is not on the expected commit');
  // The hooks' "last green pnpm check" stamp belongs to the old clone (#29).
  rmSync(join(STATE_DIR, 'stamps', `${branch}.json`), { force: true });
  run('git', ['remote', 'remove', 'origin'], clone); // nothing to push to, even by path
  const lzp = join(clone, '.lzp');
  for (const dir of ['gh', 'pnpm/store', 'pnpm/cache', 'pnpm/state'])
    mkdirSync(join(lzp, dir), { recursive: true });
  writeFileSync(join(lzp, 'task.md'), task);
  writeFileSync(
    join(lzp, 'gitconfig'),
    '[user]\n\tname = Daedalus\n\temail = daedalus@letzeuspost.invalid\n[credential]\n\thelper =\n[core]\n\thooksPath = /dev/null\n',
  );

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  Object.assign(env, {
    LZP_ROLE: 'builder',
    LZP_HARNESS_DIR: ROOT,
    GH_CONFIG_DIR: join(lzp, 'gh'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(lzp, 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
    pnpm_config_store_dir: join(lzp, 'pnpm/store'),
    pnpm_config_cache_dir: join(lzp, 'pnpm/cache'),
    pnpm_config_state_dir: join(lzp, 'pnpm/state'),
  });
  const log = join(STATE_DIR, 'runs', `${branch}-${String(Date.now())}.jsonl`);
  mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
  const prompt = `Build task #${String(issue)}. Your task is in .lzp/task.md. Follow your instructions and CLAUDE.md.`;
  const child = spawn(
    'claude',
    [
      '-p',
      '--agent',
      'daedalus-builder',
      '--settings',
      join(ROOT, '.claude/builder/settings.json'),
      '--permission-mode',
      'dontAsk',
      '--max-turns',
      option(argv, '--max-turns') ?? '200',
      '--output-format',
      'stream-json',
      '--verbose',
      prompt,
    ],
    { cwd: clone, env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  child.stdout.pipe(createWriteStream(log));
  const timer = setInterval(refreshFlag, 60_000);
  const code = await new Promise<number>((resolve) => {
    child.on('close', (c) => {
      resolve(c ?? 1);
    });
  });
  clearInterval(timer);

  const commits = run('git', ['log', '--oneline', `${baseSha}..HEAD`], clone).trim();
  console.log(`Builder finished (exit ${String(code)}). Log: ${log}`);
  console.log(commits === '' ? 'No commits.' : `Commits:\n${commits}`);
  console.log(
    existsSync(join(lzp, 'pr.md'))
      ? 'PR text ready: node scripts/ship.ts ' + String(issue)
      : 'No .lzp/pr.md.',
  );
  return code;
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
    (code) => (process.exitCode = code),
    (error: unknown) => {
      console.error(`dispatch error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
