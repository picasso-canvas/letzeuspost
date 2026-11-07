import { describe, expect, it } from 'vitest';
import { freezeFlag, slugify, taskText } from './dispatch.ts';

const paused = (flag: string) => (JSON.parse(flag) as { paused: boolean }).paused;
import { findClone, prFlags } from './ship.ts';

describe('slugify', () => {
  it('drops the milestone tag and keeps a short safe slug', () => {
    expect(slugify('[M0] Sign-in with an email link')).toBe('sign-in-with-an-email-link');
    expect(slugify('[H0] Caption counters: X weighted, TikTok UTF-16, Threads bytes')).toBe(
      'caption-counters-x-weighted-tiktok-utf-1',
    );
    expect(slugify('[M1] ক্ষ বাংলা')).toBe('task');
  });
});

describe('freezeFlag', () => {
  it('is paused unless the variable says exactly false, and carries the time', () => {
    const now = new Date('2026-11-07T05:12:00.000Z');
    expect(JSON.parse(freezeFlag('false\n', now))).toEqual({
      paused: false,
      at: '2026-11-07T05:12:00.000Z',
      source: 'AGENTS_PAUSED',
    });
    expect(paused(freezeFlag('true', now))).toBe(true);
    expect(paused(freezeFlag(null, now))).toBe(true);
    expect(paused(freezeFlag('', now))).toBe(true);
  });
});

describe('taskText', () => {
  it('holds the issue and, in a review round, the findings', () => {
    expect(taskText(7, 'Thing', 'Body', null)).toBe('# Task #7: Thing\n\nBody\n');
    expect(taskText(7, 'Thing', 'Body', '[blocking] a — b — c')).toContain(
      '## Review findings to fix (from Athena)\n\n[blocking] a — b — c',
    );
  });
});

describe('prFlags', () => {
  it('reads needs-zeus and blocked only at column 0', () => {
    expect(prFlags('**Done when**\n- [x] a\n\n**needs-zeus:** which colour?')).toEqual({
      needsZeus: true,
      blocked: false,
    });
    expect(prFlags('  **blocked:** indented, inside an item')).toEqual({
      needsZeus: false,
      blocked: false,
    });
    expect(prFlags('**Blocked:** the database isn’t up').blocked).toBe(true);
  });
});

describe('findClone', () => {
  it('finds exactly one clone for the issue', () => {
    expect(findClone(7, ['7-thing', '17-other', '7x'])).toBe('7-thing');
    expect(() => findClone(7, ['8-thing'])).toThrow(/found 0/);
    expect(() => findClone(7, ['7-a', '7-b'])).toThrow(/found 2/);
  });
});
