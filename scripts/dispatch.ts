#!/usr/bin/env node
// Dispatch (§19 step 3, #32): starts one builder on one build task.
//   node scripts/dispatch.ts <issue> [--findings <file>] [--max-turns <n>] [--dry-run]
// It runs from a clean `main`. The builder gets a fresh `--no-local` clone (never a worktree: a worktree shares .git
// hooks and settings with this checkout) with no remote, the task in .lzp/task.md, and a headless Claude Code session
// with main's builder settings (sandbox on), an allowlisted environment, LZP_ROLE=builder, LZP_HARNESS_DIR, no GitHub
// credential and no Docker socket. pnpm's store, cache and state live in the clone. The builder runs in its own
// process group: when it finishes, or as soon as the freeze switch is on, the whole group is killed, and so is any
// process carrying the run's random LZP_DISPATCH marker (the ones that left the group); a supervision tick that fails,
// or a Ctrl-C, stops it too. A process still working in the clone without the marker is listed, never killed blind,
// and the next dispatch refuses until it's gone. An old clone is moved into ~/.letzeuspost/trash/ before deletion. While it runs,
// AGENTS_PAUSED is copied into ~/.letzeuspost/paused every minute for the hooks (#29). Once the builder has started,
// nothing here runs git inside its clone (its .git could point git at config the builder wrote); the builder hands its
// work over as .lzp/branch.bundle, which ship.ts reads. Services (database, storage, mail) arrive in M0.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanMain } from './lib/clean-main.ts';
import { isEntryPoint } from './lib/entry.ts';
import { builderProcesses, killMarkedProcesses, trash } from './lib/handover.ts';
import { parseRawDiff, shipRefusals } from './lib/protected.ts';
import { REPO } from './merge-gate/collect.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';
import { BUILDERS_DIR, dispatchRecordPath, parseDispatchRecord, takenPath } from './ship.ts';

/** What a builder's environment may carry over from Athena's: enough to run Claude Code and tools, no tokens. */
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

export function builderEnv(from: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(from).filter(([key]) => ENV_ALLOW.includes(key))),
    ...extra,
  };
}

export interface Args {
  issue: number;
  dryRun: boolean;
  fresh: boolean;
  findings: string | undefined;
  maxTurns: string | undefined;
}

/** Unknown options are refused: a typo like `--dryrun` must never start a real builder. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    issue: Number.NaN,
    dryRun: false,
    fresh: false,
    findings: undefined,
    maxTurns: undefined,
  };
  const value = (i: number, flag: string): string => {
    const next = argv[i];
    if (next === undefined || next.startsWith('-')) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--fresh') args.fresh = true;
    else if (arg === '--findings') args.findings = value(++i, arg);
    else if (arg === '--max-turns') args.maxTurns = value(++i, arg);
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (!Number.isNaN(args.issue)) throw new Error('dispatch takes one issue');
    else args.issue = Number(arg);
  }
  return args;
}

/** Branch names from `git ls-remote` output, exactly as `refs/heads/<name>` gives them. */
export function headsFrom(lsRemote: string): string[] {
  return lsRemote
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length));
}

/** The branch an issue already has keeps its name (titles change); a new one is `<issue>-<slug>`. */
export function branchFor(issue: number, title: string, existing: readonly string[]): string {
  const mine = existing.filter((name) => name.startsWith(`${String(issue)}-`));
  if (mine.length > 1) throw new Error(`#${String(issue)} has two branches: ${mine.join(', ')}`);
  return mine[0] ?? `${String(issue)}-${slugify(title)}`;
}

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

/**
 * One supervision tick: re-reads the freeze switch and kills the builder when it's on. A tick that fails (the flag
 * can't be written, gh can't be run) also kills it: a builder never works without a supervisor that can stop it.
 */
export function onTick(refresh: () => boolean, kill: () => void, state: { frozen: boolean }): void {
  try {
    if (refresh()) return;
  } catch (error) {
    console.error(
      `Supervision failed (${error instanceof Error ? error.message : String(error)}): stopping the builder.`,
    );
  }
  state.frozen = true;
  kill();
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
  parts.push(
    '',
    '## Handing over (last step)',
    '',
    'Hand over your branch as your instructions say (`.lzp/base` holds the commit you started from).',
  );

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

/** Writes the flag; true when agents may work. */
function refreshFlag(): boolean {
  const variable = readVariable();
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FLAG, freezeFlag(variable, new Date()), { mode: 0o644 });
  return variable?.trim().toLowerCase() === 'false';
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

const USAGE =
  'usage: node scripts/dispatch.ts <issue> [--findings <file>] [--max-turns <n>] [--fresh] [--dry-run]';

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const issue = args.issue;
  if (!Number.isInteger(issue) || issue <= 0) {
    console.error(USAGE);
    return 2;
  }
  assertCleanMain((cmd, a) => run(cmd, a));
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
  const remoteBranches = headsFrom(
    run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${String(issue)}-*`]),
  );
  const branch = branchFor(issue, view.title, remoteBranches);
  const clone = join(BUILDERS_DIR, branch);
  // Never wipe work that hasn't been shipped yet.
  const recordFile = dispatchRecordPath(issue);
  if (existsSync(clone) && !args.fresh) {
    const record = existsSync(recordFile)
      ? parseDispatchRecord(readFileSync(recordFile, 'utf8'), issue)
      : null;
    if (
      record === null ||
      record.shippedAt === undefined ||
      record.shippedAt < record.dispatchedAt
    ) {
      console.error(
        `Refused: ${clone} holds work that hasn't been shipped. Ship it first, or pass --fresh to discard it.`,
      );
      return 1;
    }
  }

  // A review round: the branch must contain current main (so main's harness, not an old copy, loads) and must not
  // change any protected path (its .claude/ would load in the builder's session).
  let baseRef = 'refs/heads/main';
  if (
    headsFrom(run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).includes(
      branch,
    )
  ) {
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
    try {
      run('git', ['merge-base', '--is-ancestor', 'origin/main', ref]);
    } catch {
      console.error(
        `Refused: ${branch} is behind main. Update it on GitHub (gh pr update-branch) first.`,
      );
      return 1;
    }
    const refusals = shipRefusals(
      parseRawDiff(
        run('git', ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `origin/main..${ref}`]),
      ),
    ).filter((reason) => reason !== 'the branch changes nothing');
    if (refusals.length > 0) {
      console.error(`Refused: ${branch} changes protected paths:\n- ${refusals.join('\n- ')}`);
      return 1;
    }
    baseRef = ref;
  }
  const baseSha = run('git', ['rev-parse', baseRef]).trim();
  const task = taskText(
    issue,
    view.title,
    view.body,
    args.findings ? readFileSync(args.findings, 'utf8') : null,
  );
  console.log(
    `#${String(issue)} → ${clone} on ${branch} (from ${baseRef === 'refs/heads/main' ? 'main' : 'the existing branch'})`,
  );
  if (args.dryRun) return 0;

  // A fresh clone every time, through git's own transport (--no-local): nothing a builder left behind carries over,
  // and no unrelated objects or refs come along.
  const old = existsSync(recordFile)
    ? parseDispatchRecord(readFileSync(recordFile, 'utf8'), issue)
    : null;
  if (old?.marker !== undefined && killMarkedProcesses(old.marker).length > 0)
    console.log('Killed processes left from the last run.');
  const left = builderProcesses(clone);
  if (left.length > 0) {
    console.error(
      `Refused: processes still work in ${clone} (pids ${left.join(', ')}). They carry no marker, so they may not be the builder's: look, stop them, then dispatch again.`,
    );
    return 1;
  }
  trash(clone, join(STATE_DIR, 'trash')); // moved out of any leftover process's reach before it is deleted
  rmSync(takenPath(issue), { recursive: true, force: true }); // a hand-over taken from an earlier round
  const marker = randomBytes(16).toString('hex'); // in the builder's environment: finds processes that left the clone
  mkdirSync(dirname(recordFile), { recursive: true, mode: 0o700 });
  writeFileSync(
    recordFile,
    `${JSON.stringify({ issue, branch, baseSha, dispatchedAt: new Date().toISOString(), marker })}\n`,
    { mode: 0o600 },
  );
  mkdirSync(BUILDERS_DIR, { recursive: true, mode: 0o700 });
  run(
    'git',
    [
      'clone',
      '--quiet',
      '--no-local',
      '--single-branch',
      '--branch',
      'main',
      '-c',
      'core.hooksPath=/dev/null',
      ROOT,
      clone,
    ],
    BUILDERS_DIR,
  );
  run(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      `+${baseRef}:refs/heads/${branch}`,
    ],
    clone,
  );
  run('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', branch], clone);
  if (run('git', ['rev-parse', 'HEAD'], clone).trim() !== baseSha)
    throw new Error('the clone is not on the expected commit');
  run('git', ['remote', 'remove', 'origin'], clone); // nothing to push to, even by path

  const lzp = join(clone, '.lzp');
  for (const dir of ['gh', 'pnpm/store', 'pnpm/cache', 'pnpm/state'])
    mkdirSync(join(lzp, dir), { recursive: true });
  writeFileSync(join(lzp, 'task.md'), task);
  writeFileSync(join(lzp, 'base'), `${baseSha}\n`); // the builder's bundle starts here (ship checks the recorded base)
  writeFileSync(
    join(lzp, 'gitconfig'),
    '[user]\n\tname = Daedalus\n\temail = daedalus@letzeuspost.invalid\n[credential]\n\thelper =\n[core]\n\thooksPath = /dev/null\n',
  );
  const env = builderEnv(process.env, {
    LZP_ROLE: 'builder',
    LZP_HARNESS_DIR: ROOT,
    LZP_DISPATCH: marker,
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
      args.maxTurns ?? '200',
      '--output-format',
      'stream-json',
      '--verbose',
      prompt,
    ],
    { cwd: clone, env, detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  child.stdout.pipe(createWriteStream(log));
  const killGroup = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    try {
      killMarkedProcesses(marker); // the builder's own that left the group (setsid, a detached spawn)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); // let the killed ones finish exiting
      const left = builderProcesses(clone);
      if (left.length > 0) {
        console.error(
          `Processes still work in ${clone} (pids ${left.join(', ')}), not killed: they carry no marker, so they may not be the builder's. Look before shipping; ship refuses while they run.`,
        );
      }
    } catch (error) {
      console.error(
        `Couldn't look for leftover builder processes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  // The builder has its own process group, so a Ctrl-C here wouldn't reach it: stop it before dispatch exits.
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const) {
    process.on(signal, () => {
      killGroup();
      process.exit(code);
    });
  }
  const state = { frozen: false }; // set from the timer
  const timer = setInterval(() => {
    onTick(refreshFlag, killGroup, state);
  }, 60_000);
  const code = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(`Couldn't start the builder: ${error.message}`);
      resolve(1);
    });
    child.on('close', (c) => {
      resolve(c ?? 1);
    });
  });
  clearInterval(timer);
  killGroup(); // anything the builder left running in the background

  console.log(
    `Builder ${state.frozen ? 'stopped: the freeze switch is on' : 'finished'} (exit ${String(code)}). Log: ${log}`,
  );
  const ready = ['branch.bundle', 'pr.md', 'approach.md'].map(
    (name) => `${name}: ${isRegularFile(join(lzp, name)) ? 'yes' : 'no'}`,
  );
  console.log(`Handed over: ${ready.join(', ')}. Next: node scripts/ship.ts ${String(issue)}`);
  return state.frozen ? 1 : code;
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`dispatch error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
