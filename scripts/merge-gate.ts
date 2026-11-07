#!/usr/bin/env node
// The merge gate (§19): Athena merges only through this script. Usage:
//   node scripts/merge-gate.ts <pr> [--dry-run]
// It runs from a clean checkout of `main` that matches `origin/main`, so a PR can't change the gate that judges it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanMain, readMainFile } from './lib/clean-main.ts';
import { collectFacts, REPO } from './merge-gate/collect.ts';
import { evaluate } from './merge-gate/evaluate.ts';
import { transcriptPath } from './merge-gate/meta.ts';
import { listReviewedShas, logMerge, readReviews, STATE_DIR } from './merge-gate/reviews.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main(argv: string[], pr: number): number {
  const dryRun = argv.includes('--dry-run');
  assertCleanMain(run);
  const facts = collectFacts(pr, {
    gh: (args) => run('gh', args),
    git: (args) => run('git', args),
    readMainFile: (path) => readMainFile(run, path),
    readReviews: (n, sha) => readReviews(n, sha),
    listReviewedShas: (n) => listReviewedShas(n),
    // The gate re-verifies every runner-made review against Claude Code's own transcript.
    readTranscript: (sessionId) => {
      const file = transcriptPath(homedir(), ROOT, sessionId);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    stateDir: STATE_DIR,
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  });
  const result = evaluate(facts);

  console.log(`Merge gate for PR #${String(pr)} at ${facts.headSha.slice(0, 7)}`);
  for (const item of result.items) {
    console.log(`${item.ok ? '✓' : '✗'} ${String(item.id)}. ${item.title}: ${item.detail}`);
  }
  const entry = {
    at: new Date().toISOString(),
    pr,
    sha: facts.headSha,
    tier: result.tier,
    reviewers: facts.reviews.map((r) => `${r.reviewer}:${r.verdict}`),
    failed: result.items.filter((item) => !item.ok).map((item) => item.id),
  };

  if (!result.ok) {
    console.log('Refused.');
    if (!dryRun) logMerge({ ...entry, result: 'refused' });
    return 1;
  }
  if (dryRun) {
    console.log('Would merge (dry run).');
    return 0;
  }
  // Narrow the base race: refuse if main moved while the gate was checking.
  const base = run('git', ['rev-parse', 'HEAD']).trim();
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  if (run('git', ['rev-parse', 'origin/main']).trim() !== base) {
    throw new Error('main moved while the gate was checking; pull main and run the gate again');
  }
  // The message is ours, never the builder's commits or PR text (which could carry "[skip ci]").
  // --match-head-commit: a push between the checks and the merge makes GitHub refuse it.
  run('gh', [
    'pr',
    'merge',
    String(pr),
    '-R',
    REPO,
    '--squash',
    '--match-head-commit',
    facts.headSha,
    '--subject',
    `${facts.title} (#${String(pr)})`,
    '--body',
    `Merged through the merge gate (tier ${result.tier}; reviews ${entry.reviewers.join(', ')}).`,
  ]);
  logMerge({ ...entry, result: 'merged' });
  try {
    const merged = run('gh', [
      'pr',
      'view',
      String(pr),
      '-R',
      REPO,
      '--json',
      'mergeCommit',
      '--jq',
      '.mergeCommit.oid',
    ]).trim();
    logMerge({
      at: new Date().toISOString(),
      pr,
      sha: facts.headSha,
      result: 'merge-commit',
      mergeCommit: merged,
    });
    console.log(`Merged as ${merged.slice(0, 7)}.`);
  } catch {
    console.log(
      'Merged (the merge commit could not be read back; the weekly audit will match it by PR).',
    );
  }
  return 0;
}

const argv = process.argv.slice(2);
const pr = Number(argv.find((a) => !a.startsWith('--')));
if (!Number.isInteger(pr) || pr <= 0) {
  console.error('usage: node scripts/merge-gate.ts <pr> [--dry-run]');
  process.exitCode = 2;
} else {
  try {
    process.exitCode = main(argv, pr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Merge gate error: ${message}`);
    if (!argv.includes('--dry-run')) {
      logMerge({ at: new Date().toISOString(), pr, result: 'error', message });
    }
    process.exitCode = 1;
  }
}
