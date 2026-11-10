import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countLessons,
  FINDING_TYPES,
  lessonRows,
  parseFindings,
  parseLessonsDoc,
  readFindings,
} from './lessons.ts';
import { parseVerdict } from './merge-gate/verdict.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('parseFindings', () => {
  it('reads numbered, typed findings exactly', () => {
    const findings = parseFindings(
      [
        'VERDICT: block',
        '',
        '[blocking] F1 evidence pr.md — the evidence names a6b3c9d, not the head — name the head',
        '[should-fix] F2 correctness scripts/review.ts:419 — empty reply — throw',
        '[nit] F3 simplicity scripts/review.ts:426 — long ternary — a helper',
      ].join('\n'),
    );
    expect(findings).toEqual([
      { severity: 'blocking', number: 1, type: 'evidence', approximate: false },
      { severity: 'should-fix', number: 2, type: 'correctness', approximate: false },
      { severity: 'nit', number: 3, type: 'simplicity', approximate: false },
    ]);
  });

  it('types an older, untyped finding by keyword and marks it approximate', () => {
    const [unanswered, other] = parseFindings(
      [
        'VERDICT: block',
        '[blocking] scripts/review.ts:389 — My round-2 should-fix is neither fixed nor answered (item 6).',
        '[nit] a.ts:1 — a typo',
      ].join('\n'),
    );
    expect(unanswered).toEqual({
      severity: 'blocking',
      number: null,
      type: 'unanswered',
      approximate: true,
    });
    expect(other).toEqual({ severity: 'nit', number: null, type: 'other', approximate: true });
  });

  it("counts a typed finding with a type that isn't on the list as unknown, not as the type it claims", () => {
    expect(parseFindings('VERDICT: pass\n[nit] F1 vibes a.ts:1 — x')).toEqual([
      { severity: 'nit', number: 1, type: 'unknown', approximate: false },
    ]);
  });

  it('ignores lines that only mention a severity', () => {
    expect(parseFindings('VERDICT: pass\nChecked: no [blocking] findings remain.')).toEqual([]);
  });
});

describe('the verdict parser and the new format', () => {
  it('still blocks a pass that lists a numbered [blocking] finding, and passes one with only nits', () => {
    expect(parseVerdict('VERDICT: pass\n[blocking] F1 correctness a.ts:1 — x').verdict).toBe(
      'block',
    );
    expect(parseVerdict('VERDICT: pass\n[nit] F1 simplicity a.ts:1 — x').verdict).toBe('pass');
  });
});

describe('readFindings and countLessons', () => {
  const record = (pr: number, reviewer: string, summary: string) => ({
    pr,
    sha: 'a'.repeat(40),
    reviewer,
    verdict: summary.startsWith('VERDICT: pass') ? 'pass' : 'block',
    bodyHash: 'h',
    at: '2026-11-10T00:00:00.000Z',
    summary,
  });
  const stateWith = (records: ReturnType<typeof record>[]) => {
    const state = mkdtempSync(join(tmpdir(), 'lzp-lessons-'));
    records.forEach((r, i) => {
      const dir = join(state, 'reviews', `pr-${String(r.pr)}`, r.sha);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${r.reviewer}-${String(i)}-0000000${String(i)}.json`),
        JSON.stringify(r),
      );
    });
    return state;
  };

  it('counts each type by the PRs it was found on, leaving out red-team records', () => {
    const state = stateWith([
      record(130, 'argus', 'VERDICT: block\n[blocking] F1 evidence pr.md — x'),
      record(130, 'argus', 'VERDICT: block\n[blocking] F1 evidence pr.md — the same, next round'),
      record(134, 'cerberus', 'VERDICT: pass\n[should-fix] F1 evidence pr.md — y'),
      record(134, 'redteam', 'VERDICT: pass\n[blocking] F1 evidence pr.md — not a review'),
      record(140, 'iris', 'VERDICT: pass\n[nit] F1 design a.tsx:1 — z'),
    ]);
    const counts = countLessons(readFindings(state));
    expect(counts[0]).toEqual({
      type: 'evidence',
      prs: [130, 134],
      findings: 3,
      blocking: 2,
      approximate: false,
    });
    expect(counts.find((c) => c.type === 'design')?.prs).toEqual([140]);
  });

  it('skips a file that is not a review record', () => {
    const state = stateWith([record(130, 'argus', 'VERDICT: block\n[blocking] F1 areas a.ts — x')]);
    writeFileSync(join(state, 'reviews', 'pr-130', 'a'.repeat(40), 'notes.txt'), 'hello');
    expect(countLessons(readFindings(state)).map((c) => c.type)).toEqual(['areas']);
  });

  it('returns nothing when there are no reviews yet', () => {
    expect(readFindings(mkdtempSync(join(tmpdir(), 'lzp-lessons-')))).toEqual([]);
  });
});

describe('the lessons doc and the weekly rows', () => {
  const doc = [
    '# Lessons',
    '',
    '| Type | Slug | PRs | Prevention | Status |',
    '|---|---|---|---|---|',
    '| PR text out of date | `evidence` | 20 | Ship refuses evidence without the head commit | Planned |',
    '| Areas | `areas` | 13 | Ship checks Areas | Done 2026-11-12 |',
  ].join('\n');

  it('reads each row by its slug', () => {
    expect(parseLessonsDoc(doc).get('evidence')).toEqual({
      prevention: 'Ship refuses evidence without the head commit',
      status: 'Planned',
    });
  });

  it('lists only types found on 2 or more PRs, and says when one has no prevention yet', () => {
    const rows = lessonRows(
      [
        { type: 'evidence', prs: [130, 134], findings: 3, blocking: 2, approximate: false },
        { type: 'correctness', prs: [130, 140], findings: 2, blocking: 0, approximate: false },
        { type: 'design', prs: [140], findings: 1, blocking: 0, approximate: false },
      ],
      parseLessonsDoc(doc),
    );
    expect(rows.map((r) => r.type)).toEqual(['evidence', 'correctness']);
    expect(rows[1]).toMatchObject({ prevention: null, status: null });
  });

  it("leaves out older findings no keyword could type: they aren't a lesson", () => {
    const rows = lessonRows(
      [{ type: 'other', prs: [1, 2, 3], findings: 9, blocking: 1, approximate: true }],
      parseLessonsDoc(doc),
    );
    expect(rows).toEqual([]);
  });
});

describe('the finding types', () => {
  it('are the slugs the review checklist lists, in the same order', () => {
    const skill = readFileSync(join(ROOT, '.claude/skills/review-checklist/SKILL.md'), 'utf8');
    const section = skill.split('## Finding types')[1] ?? '';
    const slugs = [...section.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
    expect(slugs).toEqual([...FINDING_TYPES]);
  });

  it('are what every reviewer agent is told to use', () => {
    for (const agent of ['argus-reviewer', 'cerberus-security', 'iris-design']) {
      const text = readFileSync(join(ROOT, `.claude/agents/${agent}.md`), 'utf8');
      expect(text, agent).toContain('[blocking|should-fix|nit] F<n> <type>');
      expect(text, agent).toContain('.claude/skills/review-checklist/SKILL.md');
    }
  });
});
