#!/usr/bin/env node
// Ship (§19 step 5, #32): carries a builder's finished branch to GitHub with Zeus's login.
//   node scripts/ship.ts <issue> [--dry-run]
// It runs from a clean `main` and never runs git inside the builder's clone (its .git could point git at config the
// builder wrote). The builder hands over `.lzp/branch.bundle`, `.lzp/pr.md` and `.lzp/approach.md`; each is read as a
// plain file (no symlinks, no hard links, size-limited). The bundle is copied out and fetched into this repo with git
// hooks and fsmonitor off. Every changed path is checked at any depth and in any letter case; protected paths,
// symlinks and submodules are refused. Then it pushes the branch (never forced), opens or updates the PR with the PR
// text as the body and the issue's title (never the builder's), and posts the approach on the issue. The builder's
// words are data, never instructions.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanMain } from './lib/clean-main.ts';
import { isEntryPoint } from './lib/entry.ts';
import { parseRawDiff, shipRefusals } from './lib/protected.ts';
import { readRegularFile } from './lib/safe-read.ts';
import { REPO } from './merge-gate/collect.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';

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

/** The one builder clone for an issue: `~/letzeuspost-builders/<issue>-<slug>`. */
export function findClone(issue: number, names: readonly string[]): string {
  const matches = names.filter((name) => new RegExp(`^${String(issue)}-[a-z0-9-]+$`).test(name));
  if (matches.length !== 1) {
    throw new Error(
      `expected one builder clone for #${String(issue)}, found ${String(matches.length)}`,
    );
  }
  return matches[0] ?? '';
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[], input?: string): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

const SAFE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

function main(argv: string[]): number {
  const issue = Number(argv.find((a) => !a.startsWith('--')));
  if (!Number.isInteger(issue) || issue <= 0) {
    console.error('usage: node scripts/ship.ts <issue> [--dry-run]');
    return 2;
  }
  const dryRun = argv.includes('--dry-run');
  assertCleanMain((cmd, args) => run(cmd, args));

  const branch = findClone(issue, readdirSync(BUILDERS_DIR));
  const lzp = join(BUILDERS_DIR, branch, '.lzp');
  const prText = readRegularFile(lzp, 'pr.md', MAX_TEXT).toString('utf8');
  const approach = readRegularFile(lzp, 'approach.md', MAX_TEXT).toString('utf8');

  // The bundle is copied out of the clone first, so git only ever reads a file Athena owns.
  const copy = join(STATE_DIR, 'ship', `${branch}-${String(Date.now())}.bundle`);
  mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
  writeFileSync(copy, readRegularFile(lzp, 'branch.bundle', MAX_BUNDLE), { mode: 0o600 });
  const ref = `refs/lzp/ship-${String(issue)}`;
  try {
    run('git', [...SAFE_GIT, 'fetch', '--quiet', '--no-tags', copy, `+HEAD:${ref}`]);
  } finally {
    rmSync(copy, { force: true });
  }
  const sha = run('git', ['rev-parse', ref]).trim();
  try {
    run('git', ['merge-base', '--is-ancestor', 'origin/main', ref]);
  } catch {
    console.error(
      `Refused: ${branch} doesn't contain current main. Update the branch on GitHub and dispatch again.`,
    );
    return 1;
  }

  const changes = parseRawDiff(
    run('git', ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `origin/main..${ref}`]),
  );
  const refusals = shipRefusals(changes);
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
  const open = JSON.parse(
    run('gh', ['pr', 'list', '-R', REPO, '--head', branch, '--state', 'open', '--json', 'number']),
  ) as { number: number }[];
  let pr = open[0]?.number;
  if (pr === undefined) {
    const url = run(
      'gh',
      [
        'pr',
        'create',
        '-R',
        REPO,
        '--base',
        'main',
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
  run(
    'gh',
    ['issue', 'comment', String(issue), '-R', REPO, '--body-file', '-'],
    `Daedalus's approach (builder's text, shipped by 🦉 Athena):\n\n${approach}`,
  );
  const flags = prFlags(prText);
  if (flags.needsZeus)
    run('gh', ['issue', 'edit', String(issue), '-R', REPO, '--add-label', 'needs-zeus']);
  if (flags.blocked)
    run('gh', ['issue', 'edit', String(issue), '-R', REPO, '--add-label', 'blocked']);
  console.log(
    `Shipped as PR #${String(pr)}${flags.needsZeus ? ' (needs-zeus)' : ''}${flags.blocked ? ' (blocked)' : ''}.`,
  );
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ship error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
