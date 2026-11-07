#!/usr/bin/env node
// Records a reviewer's verdict for the exact commit and PR text the reviewer was given (§19 merge gate, item 5):
//   gh pr view <pr> -R picasso-canvas/letzeuspost --json headRefOid,body > snapshot.json   # before the review
//   node scripts/record-review.ts <pr> <argus|cerberus|iris|redteam> <summary-file> --snapshot snapshot.json \
//     [--meta <file>]
// scripts/review.ts passes --meta (the agent and its Claude Code session id), so runs it made can be told apart from
// summaries written by hand (Athena's red-team re-runs).
// The verdict is the summary's first line, `VERDICT: pass` or `VERDICT: block` (verdict.ts); anything else records a
// block. A block can only be cleared by a new commit: records are append-only. scripts/review.ts runs all of this.
// It refuses when the PR has moved on since the review started (a new push or edited text needs a new review).
// The record lives in ~/.letzeuspost/reviews/ (append-only, outside every builder clone) and is posted on the PR.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './merge-gate/collect.ts';
import { bodyHash } from './merge-gate/evaluate.ts';
import { checkTranscript, transcriptPath } from './merge-gate/meta.ts';
import { STATE_DIR, writeReview } from './merge-gate/reviews.ts';
import { REVIEWERS, type Reviewer } from './merge-gate/types.ts';
import { parseVerdict } from './merge-gate/verdict.ts';

const USAGE =
  'usage: node scripts/record-review.ts <pr> <argus|cerberus|iris|redteam> <summary-file> ' +
  '--snapshot <gh pr view --json headRefOid,body output taken before the review> [--meta <file>]';

const NAMES: Record<Reviewer, string> = {
  argus: 'Argus',
  cerberus: 'Cerberus',
  iris: 'Iris',
  redteam: 'Red-team re-run',
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const AGENTS: Partial<Record<Reviewer, string>> = {
  argus: 'argus-reviewer',
  cerberus: 'cerberus-security',
  iris: 'iris-design',
};

/** True when any existing record for this PR (any commit) already names this session. */
function sessionUsed(pr: number, sessionId: string): boolean {
  const base = join(STATE_DIR, 'reviews', `pr-${String(pr)}`);
  if (!existsSync(base)) return false;
  for (const sha of readdirSync(base)) {
    for (const name of readdirSync(join(base, sha))) {
      try {
        const record = JSON.parse(readFileSync(join(base, sha, name), 'utf8')) as {
          meta?: { sessionId?: unknown };
        };
        if (record.meta?.sessionId === sessionId) return true;
      } catch {
        // unreadable records are blocks anyway
      }
    }
  }
  return false;
}

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
  const [prArg, reviewerArg, summaryFile] = argv;
  const snapshotFile = option(argv, '--snapshot');
  const metaFile = option(argv, '--meta');
  const pr = Number(prArg);
  const reviewer = (REVIEWERS as readonly string[]).includes(reviewerArg ?? '')
    ? (reviewerArg as Reviewer)
    : null;
  if (!Number.isInteger(pr) || pr <= 0 || reviewer === null || !summaryFile || !snapshotFile) {
    console.error(USAGE);
    return 2;
  }
  const summary = readFileSync(summaryFile, 'utf8').trim();
  const { verdict, reason } = parseVerdict(summary);
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

  let meta: { agent: string; sessionId: string | null } | undefined;
  if (metaFile !== undefined) {
    const raw = JSON.parse(readFileSync(metaFile, 'utf8')) as {
      agent?: unknown;
      sessionId?: unknown;
    };
    meta = {
      agent: typeof raw.agent === 'string' ? raw.agent : '',
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    };
    // A session id must be a real Claude Code run of this reviewer's agent, on this bundle, used once per PR.
    if (meta.sessionId !== null) {
      const expected = AGENTS[reviewer];
      if (meta.agent !== expected) {
        console.error(`--meta names agent ${meta.agent}, but ${reviewer} is ${String(expected)}.`);
        return 1;
      }
      const transcript = transcriptPath(homedir(), ROOT, meta.sessionId);
      const problem = checkTranscript(
        existsSync(transcript) ? readFileSync(transcript, 'utf8') : null,
        expected,
        dirname(resolve(snapshotFile)),
      );
      if (problem !== null) {
        console.error(`Not recorded: ${problem}.`);
        return 1;
      }
      if (sessionUsed(pr, meta.sessionId)) {
        console.error(
          `Not recorded: session ${meta.sessionId} already backs another review of PR #${String(pr)}.`,
        );
        return 1;
      }
    }
  }
  const file = writeReview({
    pr,
    sha: reviewedSha,
    reviewer,
    verdict,
    bodyHash: reviewedHash,
    summary,
    at: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  });
  const comment = `🦉 Athena: review record: **${NAMES[reviewer]}**, **${verdict}** for \`${reviewedSha.slice(0, 7)}\`.\n\n${summary}`;
  gh(['pr', 'comment', String(pr), '-R', REPO, '--body-file', '-'], comment);
  console.log(
    `Recorded ${reviewer} ${verdict} (${reason}) for PR #${String(pr)} at ${reviewedSha.slice(0, 7)}: ${file}`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`record-review error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
