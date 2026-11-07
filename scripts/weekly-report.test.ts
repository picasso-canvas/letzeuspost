import { describe, expect, it } from 'vitest';
import {
  auditMain,
  isoWeek,
  renderReport,
  type LogEntry,
  type MainCommit,
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
      commit('a'.repeat(40), '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
      commit('b'.repeat(40), '2026-11-07T06:00:05Z', '[H0] Risk gate (#47)'),
    ];
    expect(auditMain(commits, log)).toEqual([]);
  });

  it('flags a commit on main the gate never merged', () => {
    const commits = [
      commit('a'.repeat(40), '2026-11-07T05:00:35Z', '[H0] Settings (#45)'),
      commit('c'.repeat(40), '2026-11-07T07:00:00Z', 'quick fix pushed straight to main'),
      commit('d'.repeat(40), '2026-11-07T07:10:00Z', 'looks like a PR (#99)'),
    ];
    expect(auditMain(commits, log).map((c) => c.sha[0])).toEqual(['c', 'd']);
  });

  it('ignores commits from before the gate existed (the bootstrap merges)', () => {
    expect(
      auditMain([commit('e'.repeat(40), '2026-11-07T04:00:00Z', 'bootstrap (#42)')], log),
    ).toEqual([]);
  });

  it('treats an empty log as "no gate yet", not as a breach', () => {
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
      guardrailHits: { 'bash:git push': 2 },
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
    expect(text).toContain('bash:git push | 2');
  });
});
