#!/usr/bin/env node
// The weekly report (§19, #32): "Week YYYY-Wnn", for Zeus.
//   node scripts/weekly-report.ts [--since YYYY-MM-DD] [--create] [--no-freeze]
// It lists every merge with its tier, reviews and merge-gate result (from ~/.letzeuspost/merges.jsonl), open
// sensitive PRs, tasks waiting on Zeus and guardrail hits. It also checks `main`'s history against the merge log:
// a commit on `main` that didn't come through the gate sets AGENTS_PAUSED=true (unless --no-freeze) and leads the
// report. Prints the report; --create opens it as an `audit` issue.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/entry.ts';
import { REPO } from './merge-gate/collect.ts';
import { STATE_DIR } from './merge-gate/reviews.ts';
import { ungatedStagingCommits } from './merge-gate/staging.ts';

export interface MainCommit {
  sha: string;
  at: string;
  subject: string;
}

export interface LogEntry {
  at: string;
  pr: number;
  result: string;
  sha?: string;
  tier?: string;
  reviewers?: string[];
  mergeCommit?: string;
  failed?: number[];
  message?: string;
  /** The branch the gate merged into (`staging` or `main`); older entries have none (main). */
  base?: string;
}

export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${String(d.getUTCFullYear())}-W${String(week).padStart(2, '0')}`;
}

/**
 * Commits on `main` that the gate didn't merge. `commits` is `git log --first-parent` order (newest first). The audit
 * starts at the first commit the gate merged (its merge commit is in the log): everything after it on main's
 * first-parent line must be a gated merge. Dates aren't trusted (whoever pushes sets them). A commit passes when it is
 * a logged merge commit, or, for a merged PR whose merge commit couldn't be read back, when its subject ends in that
 * PR's `(#n)`; each such number counts once.
 */
export function auditMain(commits: readonly MainCommit[], log: readonly LogEntry[]): MainCommit[] {
  // Only merges into main belong on main's line (older entries have no base: main).
  const onMainLog = log.filter((e) => e.base === undefined || e.base === 'main');
  const mergeCommits = new Set(
    onMainLog.filter((e) => e.result === 'merge-commit').map((e) => e.mergeCommit),
  );
  // Every gated merge must still be on main's first-parent line: a crafted merge commit could otherwise step around
  // them and hide everything after it from this walk.
  const onMain = new Set(commits.map((c) => c.sha));
  const missing: MainCommit[] = onMainLog
    .filter(
      (e) =>
        e.result === 'merge-commit' && e.mergeCommit !== undefined && !onMain.has(e.mergeCommit),
    )
    .map((e) => ({
      sha: e.mergeCommit ?? '',
      at: e.at,
      subject: `gated merge of #${String(e.pr)} is missing from main's first-parent history`,
    }));
  const anchor = commits.findLastIndex((c) => mergeCommits.has(c.sha));
  if (anchor < 0) return missing;
  const withCommit = new Set(onMainLog.filter((e) => e.result === 'merge-commit').map((e) => e.pr));
  const unmatched = new Set(
    onMainLog.filter((e) => e.result === 'merged' && !withCommit.has(e.pr)).map((e) => e.pr),
  );
  const unknown: MainCommit[] = [];
  for (const c of commits.slice(0, anchor).reverse()) {
    if (mergeCommits.has(c.sha)) continue;
    const pr = Number(/\(#(\d+)\)\s*$/.exec(c.subject)?.[1]);
    if (unmatched.has(pr)) {
      unmatched.delete(pr);
      continue;
    }
    unknown.push(c);
  }
  return [...missing, ...unknown.reverse()];
}

export interface ReportData {
  week: string;
  merges: LogEntry[];
  titles: Record<number, string>;
  unknown: MainCommit[];
  froze: boolean;
  openSensitive: { number: number; title: string }[];
  needsZeus: { number: number; title: string }[];
  guardrailHits: Record<string, number>;
}

export function renderReport(d: ReportData): string {
  const lines = [`# Week ${d.week}`, ''];
  if (d.unknown.length > 0) {
    lines.push('## ⚠️ Commits on main that skipped the merge gate', '');
    for (const c of d.unknown) lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.at}: ${c.subject}`);
    lines.push(
      '',
      d.froze
        ? 'AGENTS_PAUSED was set to true: every agent is frozen until Zeus looks.'
        : 'AGENTS_PAUSED was NOT changed (--no-freeze).',
      '',
    );
  }
  const commits = new Map(
    d.merges.filter((e) => e.result === 'merge-commit').map((e) => [e.pr, e.mergeCommit ?? '']),
  );
  const merged = d.merges.filter((e) => e.result === 'merged');
  lines.push('## Merged through the gate', '');
  if (merged.length === 0) lines.push('Nothing this week.');
  else {
    lines.push('| PR | Title | Tier | Reviews | Result |', '|---|---|---|---|---|');
    for (const e of merged) {
      const commit = commits.get(e.pr);
      lines.push(
        `| #${String(e.pr)} | ${d.titles[e.pr] ?? ''} | ${e.tier ?? ''} | ${(e.reviewers ?? []).join(', ')} | ${e.base === undefined ? (commit ? `merged as ${commit.slice(0, 7)}` : 'merged') : `merged into ${e.base}${commit ? ` as ${commit.slice(0, 7)}` : ''}`} |`,
      );
    }
  }
  const refused = d.merges.filter((e) => e.result === 'refused' || e.result === 'error');
  if (refused.length > 0) {
    lines.push('', '## Refused or failed', '');
    for (const e of refused)
      lines.push(
        `- #${String(e.pr)}: ${e.result}${e.failed ? ` (items ${e.failed.join(', ')})` : ''}${e.message ? `: ${e.message}` : ''}`,
      );
  }
  lines.push('', '## Open sensitive PRs', '');
  lines.push(
    ...(d.openSensitive.length
      ? d.openSensitive.map((p) => `- #${String(p.number)} ${p.title}`)
      : ['None.']),
  );
  lines.push('', '## Waiting on Zeus (`needs-zeus`)', '');
  lines.push(
    ...(d.needsZeus.length
      ? d.needsZeus.map((i) => `- #${String(i.number)} ${i.title}`)
      : ['None.']),
  );
  lines.push('', '## Guardrail hits', '');
  const hits = Object.entries(d.guardrailHits);
  if (hits.length === 0) lines.push('None.');
  else
    lines.push(
      '| Rule | Hits |',
      '|---|---|',
      ...hits.map(([rule, n]) => `| ${rule} | ${String(n)} |`),
    );
  lines.push(
    '',
    "_AI usage against Zeus's limits, flaky tests and product evals are added as they start (§19)._",
    '',
    '🦉 Athena',
  );
  return `${lines.join('\n')}\n`;
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

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

/** Unknown options are refused: `--creat` must not quietly skip the issue, nor `--no-freez` freeze by surprise. */
export function parseReportArgs(argv: readonly string[]): {
  since: string | null;
  create: boolean;
  freeze: boolean;
} {
  const args = { since: null as string | null, create: false, freeze: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--create') args.create = true;
    else if (arg === '--no-freeze') args.freeze = false;
    else if (arg === '--since') {
      const value = argv[++i];
      if (
        value === undefined ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value))
      )
        throw new Error('--since needs a date (YYYY-MM-DD)');
      args.since = value;
    } else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

function main(argv: string[]): number {
  let args: ReturnType<typeof parseReportArgs>;
  try {
    args = parseReportArgs(argv);
  } catch (error) {
    console.error(
      `${error instanceof Error ? error.message : String(error)}\nusage: node scripts/weekly-report.ts [--since YYYY-MM-DD] [--create] [--no-freeze]`,
    );
    return 2;
  }
  const since = args.since ? new Date(args.since) : new Date(Date.now() - 7 * 86_400_000);
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const commits = run('git', ['log', '--first-parent', '--format=%H%x09%cI%x09%s', 'origin/main'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', at = '', ...subject] = line.split('\t');
      return { sha, at, subject: subject.join('\t') };
    });
  const log = readJsonLines<LogEntry>(join(STATE_DIR, 'merges.jsonl'));
  const unknown = auditMain(commits, log);
  // Nobody pushes to staging either (no branch rules on the free plan): a commit there the gate didn't make counts too.
  // Only a missing staging branch skips this; any other failure is reported as a finding (and freezes).
  const hasStaging =
    run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/staging']).trim() !== '';
  try {
    if (!hasStaging) throw new Error('no staging');
    run('git', ['fetch', '--quiet', 'origin', '+refs/heads/staging:refs/remotes/origin/staging']);
    const onStaging = run('git', [
      'log',
      '--first-parent',
      '--format=%H%x09%cI%x09%s',
      'origin/main..origin/staging',
    ])
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [sha = '', at = '', ...subject] = line.split('\t');
        return { sha, at, subject: `on staging, not through the gate: ${subject.join('\t')}` };
      });
    const ungated = new Set(
      ungatedStagingCommits(
        onStaging.map((c) => c.sha),
        log,
      ),
    );
    unknown.push(...onStaging.filter((c) => ungated.has(c.sha)));
  } catch (error) {
    if (hasStaging) {
      unknown.push({
        sha: '',
        at: new Date().toISOString(),
        subject: `couldn't audit staging: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
      });
    }
  }
  let froze = false;
  if (unknown.length > 0 && args.freeze) {
    run('gh', ['variable', 'set', 'AGENTS_PAUSED', '-b', 'true', '-R', REPO]);
    froze = true;
  }
  const merges = log.filter((e) => Date.parse(e.at) >= since.getTime());
  const titles: Record<number, string> = {};
  for (const pr of new Set(merges.filter((e) => typeof e.pr === 'number').map((e) => e.pr))) {
    try {
      titles[pr] = run('gh', [
        'pr',
        'view',
        String(pr),
        '-R',
        REPO,
        '--json',
        'title',
        '--jq',
        '.title',
      ]).trim();
    } catch {
      titles[pr] = '';
    }
  }
  const list = (args: string[]) =>
    JSON.parse(run('gh', [...args, '-R', REPO, '--json', 'number,title'])) as {
      number: number;
      title: string;
    }[];
  const hits: Record<string, number> = {};
  for (const hit of readJsonLines<{ at?: string; rule?: string; hook?: string }>(
    join(STATE_DIR, 'logs', 'guardrail-hits.jsonl'),
  )) {
    if (hit.at !== undefined && Date.parse(hit.at) < since.getTime()) continue;
    // The hooks (#29) write {at, role, session, agent, project, hook, rule, reason, tool, detail}; rule names its hook.
    const rule = hit.rule ?? hit.hook ?? 'unknown';
    hits[rule] = (hits[rule] ?? 0) + 1;
  }
  const report = renderReport({
    week: isoWeek(new Date()),
    merges,
    titles,
    unknown,
    froze,
    openSensitive: list(['pr', 'list', '--state', 'open', '--label', 'sensitive']),
    needsZeus: list(['issue', 'list', '--state', 'open', '--label', 'needs-zeus']),
    guardrailHits: hits,
  });
  if (args.create) {
    const url = run(
      'gh',
      [
        'issue',
        'create',
        '-R',
        REPO,
        '--title',
        `Week ${isoWeek(new Date())}`,
        '--label',
        'audit',
        '--assignee',
        'picasso-canvas',
        '--body-file',
        '-',
      ],
      report,
    );
    console.log(url.trim());
  } else {
    process.stdout.write(report);
  }
  return unknown.length > 0 ? 1 : 0;
}

if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`weekly-report error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
