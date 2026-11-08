import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  branchFor,
  builderEnv,
  builderModel,
  freezeFlag,
  headsFrom,
  onTick,
  parseArgs,
  slugify,
  taskText,
} from './dispatch.ts';
import { parseRawDiff, shipRefusals } from './lib/protected.ts';
import {
  fetchBundle,
  parseDispatchRecord,
  parseShipArgs,
  prFlags,
  remoteHead,
  textOnlyTarget,
} from './ship.ts';

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
    expect(taskText(7, 'Thing', 'Body', null)).toContain('# Task #7: Thing\n\nBody\n');
    expect(taskText(7, 'Thing', 'Body', '[blocking] a — b — c')).toContain(
      '## Review findings to fix (from Athena)\n\n[blocking] a — b — c',
    );
  });

  it('holds no command to run: the hand-over command lives in the agent file', () => {
    const text = taskText(7, 'Thing', 'Body', '[blocking] a — b — c');
    expect(text).toContain('.lzp/base');
    expect(text).not.toMatch(/git bundle create/);
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

describe('textOnlyTarget (#94)', () => {
  const base = 'a'.repeat(40);

  it('ships the text alone onto an open PR whose branch is still where the round started', () => {
    expect(textOnlyTarget(93, base, base)).toEqual({ pr: 93 });
  });

  it('refuses with no open PR, a branch missing on GitHub, or a branch that moved since dispatch', () => {
    expect(textOnlyTarget(undefined, base, base)).toEqual({
      refusal: expect.stringMatching(/no open PR/) as unknown,
    });
    expect(textOnlyTarget(93, null, base)).toEqual({
      refusal: expect.stringMatching(/not on GitHub/) as unknown,
    });
    expect(textOnlyTarget(93, 'b'.repeat(40), base)).toEqual({
      refusal: expect.stringMatching(/moved/) as unknown,
    });
  });
});

describe('remoteHead', () => {
  it("reads the branch's commit from git ls-remote, and nothing else", () => {
    const sha = 'c'.repeat(40);
    expect(remoteHead(`${sha}\trefs/heads/33-x\n`, '33-x')).toBe(sha);
    expect(remoteHead('', '33-x')).toBeNull();
    expect(remoteHead(`${sha}\trefs/heads/33-xy\n`, '33-x')).toBeNull();
    expect(remoteHead('not-a-sha\trefs/heads/33-x\n', '33-x')).toBeNull();
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

  it('refuses an option it does not know, a second issue and a flag without its value', () => {
    expect(() => parseArgs(['--dryrun', '7'])).toThrow(/unknown option: --dryrun/);
    expect(() => parseArgs(['-n', '7'])).toThrow(/unknown option: -n/);
    expect(() => parseArgs(['7', '8'])).toThrow(/one issue/);
    expect(() => parseArgs(['7', '--findings'])).toThrow(/--findings needs a value/);
    expect(() => parseArgs(['7', '--max-turns', '--dry-run'])).toThrow(/--max-turns needs a value/);
  });
});

describe('parseShipArgs', () => {
  it('takes one issue and --dry-run, and refuses anything else', () => {
    expect(parseShipArgs(['7'])).toEqual({ issue: 7, dryRun: false });
    expect(parseShipArgs(['--dry-run', '7'])).toEqual({ issue: 7, dryRun: true });
    expect(() => parseShipArgs(['--dryrun', '7'])).toThrow(/unknown option: --dryrun/);
    expect(() => parseShipArgs(['7', '8'])).toThrow(/one issue/);
    expect(parseShipArgs([]).issue).toBeNaN();
  });
});

describe('headsFrom', () => {
  it('reads exact branch names from ls-remote, never a ref that only ends like one', () => {
    const out = [
      `${'a'.repeat(40)}\trefs/heads/7-thing`,
      `${'b'.repeat(40)}\trefs/heads/foo/7-thing`,
      `${'c'.repeat(40)}\trefs/tags/7-thing`,
      `${'d'.repeat(40)}\trefs/heads/7-other`,
      '',
    ].join('\n');
    expect(headsFrom(out)).toEqual(['7-thing', 'foo/7-thing', '7-other']);
    expect(headsFrom(out).includes('7-thing')).toBe(true);
    expect(headsFrom(`${'a'.repeat(40)}\trefs/heads/foo/7-x\n`).includes('7-x')).toBe(false);
  });
});

describe('onTick', () => {
  it('kills the builder when frozen, and when the refresh itself fails', () => {
    const kills: string[] = [];
    const state = { frozen: false };
    onTick(
      () => true,
      () => kills.push('k'),
      state,
    );
    expect(state.frozen).toBe(false);
    expect(kills).toEqual([]);
    onTick(
      () => false,
      () => kills.push('k'),
      state,
    );
    expect(state.frozen).toBe(true);
    const broken = { frozen: false };
    onTick(
      () => {
        throw new Error('disk full');
      },
      () => kills.push('k2'),
      broken,
    );
    expect(broken.frozen).toBe(true);
    expect(kills).toEqual(['k', 'k2']);
  });
});

function git(cwd: string, args: string[], input?: string | Buffer): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t.invalid',
    },
  });
}

describe('fetchBundle', () => {
  it('fetches a sound bundle, and a malformed one never ships', () => {
    const root = mkdtempSync(join(tmpdir(), 'lzp-fsck-'));
    onTestFinished(() => {
      rmSync(root, { recursive: true, force: true });
    });
    const builder = join(root, 'builder');
    const athena = join(root, 'athena');
    for (const dir of [builder, athena]) git(root, ['init', '--quiet', '-b', 'main', dir]);
    writeFileSync(join(builder, 'a.txt'), 'a\n');
    git(builder, ['add', 'a.txt']);
    git(builder, ['commit', '--quiet', '-m', 'good']);
    git(builder, ['bundle', 'create', '--quiet', join(root, 'good.bundle'), 'HEAD']);
    fetchBundle(join(root, 'good.bundle'), 'refs/lzp/ship-7', athena);
    expect(git(athena, ['rev-parse', 'refs/lzp/ship-7']).trim()).toMatch(/^[0-9a-f]{40}$/);

    // A tree whose entry is named "..": git's fsck refuses it (the shape behind past path-traversal CVEs).
    const blob = git(builder, ['hash-object', '-w', 'a.txt']).trim();
    const tree = git(
      builder,
      ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'],
      Buffer.concat([Buffer.from('100644 ..\0'), Buffer.from(blob, 'hex')]),
    ).trim();
    const commit = git(builder, ['commit-tree', tree, '-p', 'HEAD', '-m', 'bad']).trim();
    git(builder, ['update-ref', 'refs/heads/main', commit]);
    git(builder, ['bundle', 'create', '--quiet', join(root, 'bad.bundle'), 'HEAD']);
    // Newer git (bundle fsck) refuses it on fetch; older git (Apple's 2.39) lets it in, and ship's path check refuses
    // it before anything is pushed. Either way it never ships.
    let fetched = true;
    try {
      fetchBundle(join(root, 'bad.bundle'), 'refs/lzp/ship-8', athena);
    } catch {
      fetched = false;
    }
    if (fetched) {
      const base = git(athena, ['rev-parse', 'refs/lzp/ship-7']).trim();
      const diff = git(athena, [
        'diff',
        '--raw',
        '-z',
        '--no-renames',
        '--no-abbrev',
        `${base}..refs/lzp/ship-8`,
      ]);
      expect(shipRefusals(parseRawDiff(diff))).toContain('unsafe path: ..');
    } else {
      expect(() => git(athena, ['rev-parse', '--verify', '--quiet', 'refs/lzp/ship-8'])).toThrow();
    }
  });
});

describe('builderModel', () => {
  it("builds routine tasks on Sonnet; sensitive, unknown or missing tiers keep the agent file's Opus", () => {
    expect(builderModel('**Predicted tier:** `routine`\n')).toBe('claude-sonnet-5-5');
    expect(builderModel('**Predicted tier:** `sensitive`')).toBeNull();
    expect(builderModel('no tier here')).toBeNull();
    expect(builderModel('**Predicted tier:** `routine` or `sensitive`')).toBeNull();
    expect(
      builderModel('**Predicted tier:** `routine`\n**Predicted tier:** `sensitive`'),
    ).toBeNull();
  });
});
