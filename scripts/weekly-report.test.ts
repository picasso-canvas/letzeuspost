import { describe, expect, it } from 'vitest';
import {
  auditMain,
  isoWeek,
  renderReport,
  type LogEntry,
  type MainCommit,
  parseReportArgs,
} from './weekly-report.ts';

const commit = (sha: string, at: string, subject: string): MainCommit => ({ sha, at, subject });
const merged = (pr: number, at: string, mergeCommit?: string): LogEntry[] => [
  {
    at,
    pr,
    sha: 'h'.repeat(40),
    result: 'merged',
    tier: 'sensitive',
    reviewers: ['argus:pass', 'cerberus:pass'],
  },
  ...(mergeCommit ? [{ at, pr, result: 'merge-commit', mergeCommit }] : []),
];

describe('isoWeek', () => {
  it('names the ISO week', () => {
    expect(isoWeek(new Date('2026-11-07T12:00:00Z'))).toBe('2026-W45');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});

describe('auditMain', () => {
  const log = [
    ...merged(45, '2026-11-07T05:00:31Z', 'a'.repeat(40)),
    ...merged(47, '2026-11-07T06:00:00Z'),
  ];

  it('accepts commits that came through the gate, by merge commit or by PR number', () => {
    const commits = [
      commit('b'.repeat(40), '2026-11-07T06:00:05Z', '[H0] Risk gate (#47)'),
      commit('a'.repeat(40), '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
    ];
    expect(auditMain(commits, log)).toEqual([]);
  });

  it('flags a commit on main the gate never merged', () => {
    const commits = [
      commit('d'.repeat(40), '2026-11-07T07:10:00Z', 'looks like a PR (#99)'),
      commit('c'.repeat(40), '2026-11-07T07:00:00Z', 'quick fix pushed straight to main'),
      commit('a'.repeat(40), '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
    ];
    expect(auditMain(commits, log).map((c) => c.sha[0])).toEqual(['d', 'c']);
  });

  it('ignores commits from before the first gated merge (the bootstrap merges)', () => {
    const commits = [
      commit('a'.repeat(40), '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
      commit('e'.repeat(40), '2026-11-07T04:00:00Z', 'bootstrap (#42)'),
    ];
    expect(auditMain(commits, log)).toEqual([]);
  });

  it('treats a log with no merge commit as "no gate yet", not as a breach', () => {
    expect(auditMain([commit('f'.repeat(40), '2026-11-07T04:00:00Z', 'x')], [])).toEqual([]);
  });
});

describe('renderReport', () => {
  it('lists merges with tier, reviews and result, and puts any breach first', () => {
    const text = renderReport({
      week: '2026-W45',
      merges: merged(45, '2026-11-07T05:00:31Z', 'a'.repeat(40)),
      titles: { 45: '[H0] Settings' },
      unknown: [commit('c'.repeat(40), '2026-11-07T07:00:00Z', 'pushed straight to main')],
      froze: true,
      openSensitive: [{ number: 50, title: 'x' }],
      needsZeus: [{ number: 35, title: "[H0] Zeus's setup" }],
      guardrailHits: { 'pre-tool-use: git push': 2 },
    });
    expect(text.indexOf('Commits on main that skipped the merge gate')).toBeLessThan(
      text.indexOf('Merged'),
    );
    expect(text).toContain('AGENTS_PAUSED was set to true');
    expect(text).toContain(
      '| #45 | [H0] Settings | sensitive | argus:pass, cerberus:pass | merged as aaaaaaa |',
    );
    expect(text).toContain('#50');
    expect(text).toContain('#35');
    expect(text).toContain('pre-tool-use: git push | 2');
  });
});

describe('auditMain: first-parent history, not dates', () => {
  // newest first, as `git log --first-parent` prints them
  const gated = 'a'.repeat(40);
  const log = [...merged(45, '2026-11-07T05:00:31Z', gated), ...merged(47, '2026-11-07T06:00:00Z')];

  it('flags a backdated direct push made after the first gated merge', () => {
    const commits = [
      commit('z'.repeat(40), '2026-01-01T00:00:00Z', 'backdated push'),
      commit(gated, '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
      commit('b'.repeat(40), '2026-11-07T04:00:00Z', 'bootstrap (#42)'),
    ];
    expect(auditMain(commits, log).map((c) => c.sha[0])).toEqual(['z']);
  });

  it('accepts a (#n) only for a merged PR with no merge-commit entry, and only once', () => {
    const commits = [
      commit('d'.repeat(40), '2026-11-07T07:00:00Z', 'reuses (#47)'),
      commit('c'.repeat(40), '2026-11-07T06:00:05Z', '[H0] Risk gate (#47)'),
      commit('e'.repeat(40), '2026-11-07T05:30:00Z', 'pretends (#45)'),
      commit(gated, '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
    ];
    expect(auditMain(commits, log).map((c) => c.sha[0])).toEqual(['d', 'e']);
  });
});

describe('auditMain: gated merges must stay on main', () => {
  it('flags a logged merge commit that is missing from the first-parent line', () => {
    const log = [
      ...merged(45, '2026-11-07T05:00:31Z', 'a'.repeat(40)),
      ...merged(47, '2026-11-07T06:00:00Z', 'b'.repeat(40)),
    ];
    // a crafted merge made main's first-parent line skip both gated merges
    const commits = [
      commit('x'.repeat(40), '2026-11-07T08:00:00Z', 'Merge branch main'),
      commit('e'.repeat(40), '2026-11-07T04:00:00Z', 'bootstrap (#42)'),
    ];
    const flagged = auditMain(commits, log);
    expect(flagged.map((c) => c.sha[0])).toEqual(['a', 'b']);
    expect(flagged[0]?.subject).toMatch(/missing from main/);
  });
});

describe('parseReportArgs', () => {
  it('reads --since, --create and --no-freeze, and refuses anything else', () => {
    expect(parseReportArgs([])).toEqual({ since: null, create: false, freeze: true });
    expect(parseReportArgs(['--since', '2026-11-01', '--create', '--no-freeze'])).toEqual({
      since: '2026-11-01',
      create: true,
      freeze: false,
    });
    expect(() => parseReportArgs(['--creat'])).toThrow(/unknown option: --creat/);
    expect(() => parseReportArgs(['--no-freez'])).toThrow(/unknown option/);
    expect(() => parseReportArgs(['--since'])).toThrow(/--since needs a date/);
    expect(() => parseReportArgs(['--since', 'last week'])).toThrow(/--since needs a date/);
    expect(() => parseReportArgs(['extra'])).toThrow(/unexpected argument/);
  });
});

describe('renderReport: staging (Zeus, 2026-11-07)', () => {
  it('says which branch each merge went into', () => {
    const report = renderReport({
      week: '2026-W45',
      merges: [
        {
          at: '2026-11-07T10:00:00Z',
          pr: 70,
          result: 'merged',
          tier: 'routine',
          reviewers: [],
          base: 'staging',
        },
        {
          at: '2026-11-07T11:00:00Z',
          pr: 75,
          result: 'merged',
          tier: 'sensitive',
          reviewers: ['argus:pass@abc1234'],
          base: 'main',
        },
      ],
      titles: { 70: '[M0] Workspaces', 75: '[Batch] 5 tasks' },
      unknown: [],
      froze: false,
      openSensitive: [],
      needsZeus: [],
      guardrailHits: {},
    });
    expect(report).toContain('| #70 | [M0] Workspaces | routine |  | merged into staging |');
    expect(report).toContain(
      '| #75 | [Batch] 5 tasks | sensitive | argus:pass@abc1234 | merged into main |',
    );
  });
});
