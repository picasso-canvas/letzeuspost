#!/usr/bin/env node
// The learning loop's count (§19 Learning loop, #137): every finding in ~/.letzeuspost/reviews/, by type and PR.
//   node scripts/lessons.ts
// Reviewers write `[blocking|should-fix|nit] F<n> <type> path:line — …`, with a type from the review checklist, so a
// typed finding is counted exactly. Findings from before types existed are typed by keyword and marked approximate.
// A type found on 2 or more PRs needs a prevention (docs/ops/lessons.md); the weekly report lists them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEntryPoint } from './lib/entry.ts';
import { REVIEW_FILE, STATE_DIR } from './merge-gate/reviews.ts';

/** The review checklist's finding types, in its order (a test keeps the two the same). */
export const FINDING_TYPES = [
  'correctness',
  'tests-first',
  'areas',
  'plan',
  'simplicity',
  'evidence',
  'decision-record',
  'unanswered',
  'guardrails',
  'steering',
  'isolation',
  'auth',
  'fetching',
  'uploads',
  'ai',
  'schema',
  'billing',
  'secrets',
  'dependencies',
  'security',
  'design',
  'states',
  'a11y',
  'copy',
] as const;

export type Severity = 'blocking' | 'should-fix' | 'nit';

export interface Finding {
  severity: Severity;
  number: number | null;
  /** A slug from FINDING_TYPES, `unknown` for a typed finding with another type, `other` for an untyped one. */
  type: string;
  approximate: boolean;
}

export interface LessonCount {
  type: string;
  prs: number[];
  findings: number;
  blocking: number;
  approximate: boolean;
}

export interface LessonRow extends LessonCount {
  prevention: string | null;
  status: string | null;
}

// The first count's keyword rules (2026-11-10), for findings written before they had a type.
const KEYWORDS: [string, RegExp][] = [
  ['unanswered', /neither fixed nor answered|unanswered|nobody answered|not answered/i],
  ['decision-record', /no decision is recorded|nothing records|decision.*not recorded/i],
  [
    'evidence',
    /PR text (still|doesn.t|stops)|out of date|doesn.t match the code|no longer matches/i,
  ],
  ['tests-first', /tests? (were )?written first|tests-first|failing-test commit/i],
  ['areas', /outside .*Areas|not in .*Areas/i],
];

const LINE = /^\[(blocking|should-fix|nit)\]\s+(.*)$/;
const TYPED = /^F(\d+)\s+([a-z0-9-]+)\b/;

export function parseFindings(summary: string): Finding[] {
  const findings: Finding[] = [];
  for (const raw of summary.split(/\r\n?|\n/)) {
    const line = LINE.exec(raw.trim());
    if (!line) continue;
    const severity = line[1] as Severity;
    const rest = line[2] ?? '';
    const typed = TYPED.exec(rest);
    if (typed) {
      const type = typed[2] ?? '';
      findings.push({
        severity,
        number: Number(typed[1]),
        type: (FINDING_TYPES as readonly string[]).includes(type) ? type : 'unknown',
        approximate: false,
      });
    } else {
      const type = KEYWORDS.find(([, pattern]) => pattern.test(rest))?.[0] ?? 'other';
      findings.push({ severity, number: null, type, approximate: true });
    }
  }
  return findings;
}

/** Every reviewer's findings (red-team records are Athena's, not reviews), each with its PR. */
export function readFindings(stateDir = STATE_DIR): (Finding & { pr: number })[] {
  const root = join(stateDir, 'reviews');
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  const findings: (Finding & { pr: number })[] = [];
  for (const prDir of list(root)) {
    const pr = Number(/^pr-(\d+)$/.exec(prDir)?.[1]);
    if (!Number.isInteger(pr)) continue;
    for (const sha of list(join(root, prDir))) {
      for (const file of list(join(root, prDir, sha))) {
        // Reviews only: a red-team record is Athena's, and the record must say the reviewer its name does.
        const named = REVIEW_FILE.exec(file)?.[1];
        if (named === undefined || named === 'redteam') continue;
        let record: { reviewer?: unknown; summary?: unknown };
        try {
          record = JSON.parse(readFileSync(join(root, prDir, sha, file), 'utf8')) as typeof record;
        } catch {
          continue;
        }
        const { reviewer, summary } = record;
        if (reviewer !== named || typeof summary !== 'string') continue;
        findings.push(...parseFindings(summary).map((f) => ({ ...f, pr })));
      }
    }
  }
  return findings;
}

/** Each type with the PRs it was found on, most PRs first. */
export function countLessons(findings: readonly (Finding & { pr: number })[]): LessonCount[] {
  const byType = new Map<string, LessonCount>();
  for (const f of findings) {
    const count = byType.get(f.type) ?? {
      type: f.type,
      prs: [],
      findings: 0,
      blocking: 0,
      approximate: false,
    };
    if (!count.prs.includes(f.pr)) count.prs.push(f.pr);
    count.findings += 1;
    if (f.severity === 'blocking') count.blocking += 1;
    count.approximate ||= f.approximate;
    byType.set(f.type, count);
  }
  return [...byType.values()]
    .map((c) => ({ ...c, prs: [...c.prs].sort((a, b) => a - b) }))
    .sort((a, b) => b.prs.length - a.prs.length || b.findings - a.findings);
}

/** docs/ops/lessons.md's rows, by the slug in their `Slug` column. */
export function parseLessonsDoc(
  markdown: string,
): Map<string, { prevention: string; status: string }> {
  const rows = new Map<string, { prevention: string; status: string }>();
  let columns: string[] | null = null;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      columns = null;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (columns === null) {
      columns = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const at = (name: string) => cells[columns?.indexOf(name) ?? -1] ?? '';
    const slug = at('slug').replace(/`/g, '');
    if (slug !== '') rows.set(slug, { prevention: at('prevention'), status: at('status') });
  }
  return rows;
}

/** The weekly report's lessons: each type found on 2 or more PRs, with its prevention, or none yet (untyped older findings and mistyped ones aren't a type). */
export function lessonRows(
  counts: readonly LessonCount[],
  doc: ReadonlyMap<string, { prevention: string; status: string }>,
): LessonRow[] {
  return counts
    .filter((c) => c.prs.length >= 2 && c.type !== 'other' && c.type !== 'unknown')
    .map((c) => ({
      ...c,
      prevention: doc.get(c.type)?.prevention ?? null,
      status: doc.get(c.type)?.status ?? null,
    }));
}

function main(): number {
  const counts = countLessons(readFindings());
  const lines = ['| Type | PRs | Findings | Blocking |', '|---|---|---|---|'];
  for (const c of counts)
    lines.push(
      `| \`${c.type}\`${c.approximate ? ' (approximate)' : ''} | ${String(c.prs.length)} | ${String(c.findings)} | ${String(c.blocking)} |`,
    );
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main();
