#!/usr/bin/env node
// Records a reviewer's verdict for the exact commit and PR text the reviewer was given (§19 merge gate, item 5):
//   gh pr view <pr> -R picasso-canvas/letzeuspost --json headRefOid,body > snapshot.json   # before the review
//   node scripts/record-review.ts <pr> <argus|cerberus|iris|redteam> <pass|block> <summary-file> \
//     --snapshot snapshot.json
// A block can only be cleared by a new commit: records are append-only.
// It refuses when the PR has moved on since the review started (a new push or edited text needs a new review).
// The record lives in ~/.letzeuspost/reviews/ (append-only, outside every builder clone) and is posted on the PR.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { REPO } from './merge-gate/collect.ts';
import { bodyHash } from './merge-gate/evaluate.ts';
import { writeReview } from './merge-gate/reviews.ts';
import { REVIEWERS, type Reviewer, type Verdict } from './merge-gate/types.ts';

const USAGE =
  'usage: node scripts/record-review.ts <pr> <argus|cerberus|iris|redteam> <pass|block> <summary-file> ' +
  '--snapshot <gh pr view --json headRefOid,body output taken before the review>';

const NAMES: Record<Reviewer, string> = {
  argus: 'Argus',
  cerberus: 'Cerberus',
  iris: 'Iris',
  redteam: 'Red-team re-run',
};

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function main(argv: string[]): number {
  const [prArg, reviewerArg, verdictArg, summaryFile] = argv;
  const snapshotFile = option(argv, '--snapshot');
  const pr = Number(prArg);
  const reviewer = (REVIEWERS as readonly string[]).includes(reviewerArg ?? '')
    ? (reviewerArg as Reviewer)
    : null;
  const verdict: Verdict | null =
    verdictArg === 'pass' || verdictArg === 'block' ? verdictArg : null;
  if (
    !Number.isInteger(pr) ||
    pr <= 0 ||
    reviewer === null ||
    verdict === null ||
    !summaryFile ||
    !snapshotFile
  ) {
    console.error(USAGE);
    return 2;
  }
  const summary = readFileSync(summaryFile, 'utf8').trim();
  const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as {
    headRefOid?: unknown;
    body?: unknown;
  };
  if (typeof snapshot.headRefOid !== 'string' || typeof snapshot.body !== 'string') {
    console.error('the snapshot must be the JSON from `gh pr view --json headRefOid,body`');
    return 2;
  }
  const reviewedSha = snapshot.headRefOid;
  const reviewedHash = bodyHash(snapshot.body);
  const view = JSON.parse(
    gh(['pr', 'view', String(pr), '-R', REPO, '--json', 'headRefOid,body']),
  ) as { headRefOid: string; body: string };

  if (view.headRefOid !== reviewedSha) {
    console.error(
      `PR #${String(pr)} moved on: reviewed ${reviewedSha.slice(0, 7)}, now ${view.headRefOid.slice(0, 7)}. Review again.`,
    );
    return 1;
  }
  if (bodyHash(view.body) !== reviewedHash) {
    console.error(`PR #${String(pr)}'s text changed since the review started. Review again.`);
    return 1;
  }

  const file = writeReview({
    pr,
    sha: reviewedSha,
    reviewer,
    verdict,
    bodyHash: reviewedHash,
    summary,
    at: new Date().toISOString(),
  });
  const comment = `🦉 Athena: review record: **${NAMES[reviewer]}**, **${verdict}** for \`${reviewedSha.slice(0, 7)}\`.\n\n${summary}`;
  gh(['pr', 'comment', String(pr), '-R', REPO, '--body-file', '-'], comment);
  console.log(
    `Recorded ${reviewer} ${verdict} for PR #${String(pr)} at ${reviewedSha.slice(0, 7)}: ${file}`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`record-review error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
