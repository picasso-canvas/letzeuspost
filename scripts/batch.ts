#!/usr/bin/env node
// The batch (§19, Zeus 2026-11-07): builder PRs merge into `staging` on the automatic checks; the full review
// (Argus, Cerberus, and Iris from the first UI milestone) happens once per batch, on the PR from `staging` into
// `main`.
//   node scripts/batch.ts [--open]
// It runs from a clean `main` and reports the open feature (§19, Zeus 2026-11-10, #139): its tasks, which of them the
// gate merged into `staging`, and the changed lines. The batch is due when every task of the feature is there and its
// journey test is no longer marked as expected to fail, as a part when `staging` is ~1,500 changed lines ahead, or when
// `staging` holds only follow-ups (lib/features.ts decides). With --open, a due batch's PR is opened (or its text
// brought up to date): it closes every task's issues and ticks a task only when the merge log shows the gate merged it
// into staging. Then Athena runs scripts/review.ts and the merge gate on it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanMain } from './lib/clean-main.ts';
import { isEntryPoint } from './lib/entry.ts';
import { featureBatch, featureOf, journeyMarked, type TaskIssue } from './lib/features.ts';
import { REPO } from './merge-gate/collect.ts';
import { issueFromBranch } from './merge-gate/staging.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';

/** The task PRs on `staging` and not on `main`, oldest first, from the gate's squash subjects (`Title (#n)`). */
export function taskPrs(firstParentLog: string): number[] {
  return firstParentLog
    .split('\n')
    .map((subject) => /\(#(\d+)\)$/.exec(subject.trim())?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .reverse();
}

export interface BatchTask {
  pr: number;
  title: string;
  issues: number[];
  /** True when the merge log shows the gate merged this PR into staging. */
  gated: boolean;
}

/** The batch PR's text: it closes every task issue, with one Done-when box per issue. */
export function batchBody(tasks: readonly BatchTask[]): string {
  const issues = tasks.flatMap((t) => t.issues.map((issue) => ({ issue, t })));
  return [
    issues.map(({ issue }) => `Closes #${String(issue)}`).join('\n'),
    '',
    'Agent: Athena',
    '',
    `The batch from \`staging\` into \`main\` (§19): ${String(tasks.length)} task PRs, each merged into staging through the gate on the automatic checks (and Cerberus for risky areas). This is their full review.`,
    '',
    '**Done when**',
    ...issues.map(({ issue, t }) =>
      t.gated
        ? `- [x] #${String(issue)} (PR #${String(t.pr)}): merged into staging through the gate`
        : `- [ ] #${String(issue)} (PR #${String(t.pr)}): not found in the merge log as merged into staging`,
    ),
    '',
    '**Tasks**',
    ...tasks.map((t) => `- #${String(t.pr)} ${t.title}`),
    '',
  ].join('\n');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[], input?: string): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

/** An issue's labels, milestone and body, as dispatch and batch.ts judge a task by them. */
export function taskIssue(
  n: number,
  gh: (args: string[]) => string = (args) => run('gh', args),
): TaskIssue {
  const view = JSON.parse(
    gh(['issue', 'view', String(n), '-R', REPO, '--json', 'number,labels,milestone,body']),
  ) as {
    number: number;
    labels: { name: string }[];
    milestone: { title: string } | null;
    body: string;
  };
  return {
    number: view.number,
    labels: view.labels.map((l) => l.name),
    milestone: view.milestone?.title ?? null,
    body: view.body,
  };
}

/** The feature's journey test files on `staging` (`tests/journeys/<feature>.*`), with their text. */
function journeyFiles(feature: string): { path: string; text: string }[] {
  return run('git', ['ls-tree', '-r', '--name-only', 'origin/staging', '--', 'tests/journeys/'])
    .split('\n')
    .filter((path) => path.startsWith(`tests/journeys/${feature}.`))
    .map((path) => ({ path, text: run('git', ['show', `origin/staging:${path}`]) }));
}

/** The task PRs the gate merged into staging, from its merge log (#132 reads it too); none when there's no log. */
export function gatedIntoStaging(stateDir = STATE_DIR): Set<number> {
  let text: string;
  try {
    text = readFileSync(join(stateDir, 'merges.jsonl'), 'utf8');
  } catch {
    return new Set();
  }
  const prs = new Set<number>();
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line) as { pr?: unknown; result?: unknown; base?: unknown };
      if (entry.result === 'merged' && entry.base === 'staging' && typeof entry.pr === 'number')
        prs.add(entry.pr);
    } catch {
      // not a log line
    }
  }
  return prs;
}

function main(argv: string[]): number {
  const unknown = argv.filter((a) => a !== '--open');
  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown.join(' ')}\nusage: node scripts/batch.ts [--open]`);
    return 2;
  }
  assertCleanMain((cmd, args) => run(cmd, args));
  run('git', [
    'fetch',
    '--quiet',
    '--no-tags',
    'origin',
    '+refs/heads/staging:refs/remotes/origin/staging',
  ]);
  const prs = taskPrs(
    run('git', ['log', '--first-parent', '--format=%s', 'origin/main..origin/staging']),
  );
  const stat = run('git', ['diff', '--shortstat', 'origin/main...origin/staging']);
  const lines = [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce(
    (n, m) => n + Number(m[1]),
    0,
  );
  const gated = gatedIntoStaging();
  // GitHub links no issues for PRs into staging: each task's issue comes from its branch name (dispatch's record).
  const tasks: BatchTask[] = prs.map((pr) => {
    const view = JSON.parse(
      run('gh', ['pr', 'view', String(pr), '-R', REPO, '--json', 'title,headRefName']),
    ) as { title: string; headRefName: string };
    const issue = issueFromBranch(view.headRefName);
    return { pr, title: view.title, issues: issue === null ? [] : [issue], gated: gated.has(pr) };
  });
  // Only what the gate merged counts as on staging.
  const onStaging = tasks.filter((t) => t.gated).flatMap((t) => t.issues);
  const issues: Record<number, TaskIssue> = {};
  for (const n of onStaging) issues[n] = taskIssue(n);
  const features = [
    ...new Set(onStaging.map((n) => featureOf(issues[n]?.labels ?? [])).filter((f) => f !== null)),
  ];
  const feature = features.length === 1 ? features[0] : undefined;
  const featureTasks =
    feature === undefined
      ? []
      : (
          JSON.parse(
            run('gh', [
              'issue',
              'list',
              '-R',
              REPO,
              '--label',
              `feature:${feature}`,
              '--state',
              'open',
              '--limit',
              '100',
              '--json',
              'number',
            ]),
          ) as { number: number }[]
        ).map((i) => i.number);
  const verdict = featureBatch({
    onStaging,
    issues,
    featureTasks,
    journeyMarked: feature !== undefined && journeyMarked(journeyFiles(feature), feature),
    lines,
  });
  console.log(
    `staging is ${String(prs.length)} task PRs and ${String(lines)} changed lines ahead of main${feature === undefined ? '' : `; open feature "${feature}": ${featureTasks.map((n) => `#${String(n)}${onStaging.includes(n) ? ' (on staging)' : ''}`).join(', ')}`}. The batch is ${verdict.due ? 'due' : 'not due'}: ${verdict.reason}.`,
  );
  if (!argv.includes('--open') || !verdict.due) return 0;
  const body = batchBody(tasks);
  const open = JSON.parse(
    run('gh', [
      'pr',
      'list',
      '-R',
      REPO,
      '--base',
      'main',
      '--head',
      'staging',
      '--state',
      'open',
      '--json',
      'number',
    ]),
  ) as { number: number }[];
  const existing = open[0]?.number;
  if (existing === undefined) {
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
        'staging',
        '--title',
        `[Batch] ${String(prs.length)} tasks: ${prs.map((n) => `#${String(n)}`).join(', ')}`,
        '--body-file',
        '-',
      ],
      body,
    );
    console.log(`Opened the batch PR: ${url.trim()}. Next: node scripts/review.ts <its number>.`);
  } else {
    run('gh', ['pr', 'edit', String(existing), '-R', REPO, '--body-file', '-'], body);
    console.log(`Brought batch PR #${String(existing)} up to date.`);
  }
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`batch error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
