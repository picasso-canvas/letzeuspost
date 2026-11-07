import { describe, expect, it } from 'vitest';
import { branchFor, builderEnv, freezeFlag, parseArgs, slugify, taskText } from './dispatch.ts';
import { parseDispatchRecord, prFlags } from './ship.ts';

const paused = (flag: string) => (JSON.parse(flag) as { paused: boolean }).paused;

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
    expect(taskText(7, 'Thing', 'Body', null, 'b'.repeat(40))).toContain(
      '# Task #7: Thing\n\nBody\n',
    );
    expect(taskText(7, 'Thing', 'Body', '[blocking] a — b — c', 'b'.repeat(40))).toContain(
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

describe('branchFor', () => {
  it('keeps the branch an issue already has, whatever its title says now', () => {
    expect(branchFor(7, 'New title', ['7-old-title'])).toBe('7-old-title');
    expect(branchFor(7, '[M0] Sign-in', [])).toBe('7-sign-in');
    expect(branchFor(7, 'x', ['17-other', '70-other'])).toBe('7-x');
    expect(() => branchFor(7, 'x', ['7-a', '7-b'])).toThrow(/two branches/);
  });
});

describe('parseDispatchRecord', () => {
  it("reads Athena's record of a dispatch, and refuses anything malformed", () => {
    const ok = {
      issue: 7,
      branch: '7-thing',
      baseSha: 'b'.repeat(40),
      dispatchedAt: '2026-11-07T09:00:00Z',
    };
    expect(parseDispatchRecord(JSON.stringify(ok), 7)).toEqual(ok);
    expect(() => parseDispatchRecord(JSON.stringify({ ...ok, issue: 8 }), 7)).toThrow();
    expect(() => parseDispatchRecord(JSON.stringify({ ...ok, branch: '../x' }), 7)).toThrow();
    expect(() => parseDispatchRecord(JSON.stringify({ ...ok, baseSha: 'abc' }), 7)).toThrow();
  });
});

describe('builderEnv', () => {
  it("starts from an allowlist, never from Athena's whole environment", () => {
    const env = builderEnv(
      {
        PATH: '/bin',
        HOME: '/h',
        GH_ENTERPRISE_TOKEN: 't',
        SSH_AUTH_SOCK: '/s',
        GIT_ASKPASS: 'x',
        ANTHROPIC_API_KEY: 'k',
      },
      { LZP_ROLE: 'builder' },
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', LZP_ROLE: 'builder' });
  });
});

describe('parseArgs', () => {
  it('reads the issue wherever it sits, and flags with values', () => {
    expect(parseArgs(['--dry-run', '7'])).toEqual({
      issue: 7,
      dryRun: true,
      fresh: false,
      findings: undefined,
      maxTurns: undefined,
    });
    expect(parseArgs(['7', '--fresh', '--findings', 'f.md', '--max-turns', '50'])).toEqual({
      issue: 7,
      dryRun: false,
      fresh: true,
      findings: 'f.md',
      maxTurns: '50',
    });
    expect(parseArgs(['--findings', '7']).issue).toBeNaN();
  });
});

describe('taskText', () => {
  it('ends with the bundle step', () => {
    expect(taskText(7, 'Thing', 'Body', null, 'b'.repeat(40))).toContain(
      `git bundle create .lzp/branch.bundle ${'b'.repeat(40)}..HEAD`,
    );
  });
});
