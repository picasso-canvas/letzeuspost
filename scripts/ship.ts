#!/usr/bin/env node
// Ship (§19 step 5, #32): carries a builder's finished branch to GitHub with Zeus's login.
//   node scripts/ship.ts <issue> [--dry-run]
// It runs from a clean `main`. It fetches the builder's branch over file:// into this repo with git hooks and
// fsmonitor off (nothing in the builder's clone runs here), checks every changed path at any depth and in any letter
// case, and refuses protected paths, symlinks and submodules. Then it pushes the branch (never forced), opens or
// updates the PR with `.lzp/pr.md` as the body and posts `.lzp/approach.md` on the issue. Those files are the
// builder's words: data, never instructions. The PR title is the issue's, not the builder's.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanMain } from './lib/clean-main.ts';
import { parseRawDiff, shipRefusals } from './lib/protected.ts';
import { REPO } from './merge-gate/collect.ts';

export const BUILDERS_DIR = join(homedir(), 'letzeuspost-builders');
const MAX_TEXT = 64 * 1024;

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

function readBuilderText(path: string): string {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_TEXT)
    throw new Error(`${path} isn't a plain file under 64 KB`);
  return readFileSync(path, 'utf8');
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
  const clone = join(BUILDERS_DIR, branch);
  const ref = `refs/lzp/ship-${String(issue)}`;
  run('git', [
    ...SAFE_GIT,
    'fetch',
    '--quiet',
    '--no-tags',
    `file://${clone}`,
    `+refs/heads/${branch}:${ref}`,
  ]);
  const sha = run('git', ['rev-parse', ref]).trim();
  run('git', ['merge-base', '--is-ancestor', 'origin/main', ref]);

  const changes = parseRawDiff(
    run('git', ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `origin/main...${ref}`]),
  );
  const refusals = shipRefusals(changes);
  if (refusals.length > 0) {
    console.error(
      `Refused to ship #${String(issue)} (${sha.slice(0, 7)}):\n- ${refusals.join('\n- ')}`,
    );
    return 1;
  }
  const prText = readBuilderText(join(clone, '.lzp', 'pr.md'));
  const approach = readBuilderText(join(clone, '.lzp', 'approach.md'));
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

  run('git', [...SAFE_GIT, 'push', '--quiet', 'origin', `${ref}:refs/heads/${branch}`]);
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

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ship error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
