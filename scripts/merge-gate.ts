#!/usr/bin/env node
// The merge gate (§19): Athena merges only through this script. Usage:
//   node scripts/merge-gate.ts <pr> [--dry-run]
// It runs from a clean checkout of `main` that matches `origin/main`, so a PR can't change the gate that judges it.
// It merges builder PRs into `staging`, and the batch PR from `staging` or Athena's harness PRs into `main`; after every
// merge into `main` it merges `main` into `staging` on GitHub, so builders always start from main's harness (§19).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanMain, readMainFile } from './lib/clean-main.ts';
import { collectFacts, REPO } from './merge-gate/collect.ts';
import { evaluate, kindOf } from './merge-gate/evaluate.ts';
import { transcriptPath } from './merge-gate/meta.ts';
import {
  listReviewedShas,
  logMerge,
  readMergeLog,
  readReviews,
  STATE_DIR,
} from './merge-gate/reviews.ts';
import type { StagingLogEntry } from './merge-gate/staging.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * After a merge into main, main is merged into staging on GitHub (never the other way outside a batch PR), so builders
 * always start from main's harness. A conflict is reported for Athena to settle; dispatch refuses until staging
 * contains main again.
 */
function syncStaging(): void {
  try {
    const out = run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${REPO}/merges`,
      '-f',
      'base=staging',
      '-f',
      'head=main',
      '-f',
      'commit_message=Merge main into staging (merge gate)',
      '--jq',
      '.sha // ""',
    ]).trim();
    console.log(
      out === ''
        ? 'staging already contains main.'
        : `Merged main into staging as ${out.slice(0, 7)}.`,
    );
    logMerge({ at: new Date().toISOString(), result: 'staging-sync', mergeCommit: out });
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    console.error(
      `Couldn't merge main into staging: ${typeof stderr === 'string' ? stderr.trim() : 'unknown'}. Settle it before dispatching builders.`,
    );
    logMerge({ at: new Date().toISOString(), result: 'staging-sync-failed' });
  }
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
    readMergeLog: () =>
      readMergeLog().map((e) => ({
        result: String(e.result),
        ...(typeof e.base === 'string' ? { base: e.base } : {}),
        ...(typeof e.mergeCommit === 'string' ? { mergeCommit: e.mergeCommit } : {}),
      })) satisfies StagingLogEntry[],
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
    base: facts.baseRef,
    kind: kindOf(facts),
    // A review made before an update from main says where it came from, for Zeus's audit.
    reviewers: facts.reviews.map(
      (r) =>
        `${r.reviewer}:${r.verdict}${r.carriedFrom === undefined ? '' : `@${r.carriedFrom.slice(0, 7)}`}`,
    ),
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
  // Narrow the base race: refuse if main moved while the gate was checking (and staging, for a PR into it).
  const main0 = run('git', ['rev-parse', 'HEAD']).trim();
  const staging0 =
    facts.baseRef === 'staging' ? run('git', ['rev-parse', 'origin/staging']).trim() : null;
  run('git', ['fetch', '--quiet', 'origin', 'main', ...(staging0 === null ? [] : ['staging'])]);
  if (run('git', ['rev-parse', 'origin/main']).trim() !== main0) {
    throw new Error('main moved while the gate was checking; pull main and run the gate again');
  }
  if (staging0 !== null && run('git', ['rev-parse', 'origin/staging']).trim() !== staging0) {
    throw new Error('staging moved while the gate was checking; run the gate again');
  }
  // The message is ours, never the builder's commits or PR text (which could carry "[skip ci]").
  // --match-head-commit: a push between the checks and the merge makes GitHub refuse it.
  run('gh', [
    'pr',
    'merge',
    String(pr),
    '-R',
    REPO,
    // A batch merges with a merge commit, so main contains staging's task commits and the next batch counts only new
    // ones; the rest are squashed. Builder and harness branches go once merged; staging (the batch's head) stays.
    // The repo's own auto-delete is off, or it would delete staging after a batch.
    ...(kindOf(facts) === 'batch' ? ['--merge'] : ['--squash', '--delete-branch']),
    '--match-head-commit',
    facts.headSha,
    '--subject',
    `${facts.title} (#${String(pr)})`,
    '--body',
    `Merged through the merge gate (tier ${result.tier}; reviews ${entry.reviewers.join(', ')}).`,
  ]);
  logMerge({ ...entry, result: 'merged' });
  if (facts.baseRef === 'main') syncStaging();
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
      base: facts.baseRef,
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
