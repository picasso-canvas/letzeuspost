import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  auditStaging,
  issueFromBranch,
  mergeArgs,
  readStagingLog,
  stagingProblems,
  stagingRefusal,
  syncStaging,
  toStagingLogEntry,
  unreadMergeCommitNote,
  ungatedStagingCommits,
} from './staging.ts';

const sha = (c: string) => c.repeat(40);

describe('ungatedStagingCommits', () => {
  it('lists every first-parent commit on staging the gate neither merged into staging nor synced from main', () => {
    const log = [
      { result: 'merge-commit', base: 'staging', mergeCommit: sha('1') },
      { result: 'staging-sync', mergeCommit: sha('2') },
      { result: 'merge-commit', base: 'main', mergeCommit: sha('3') },
      { result: 'merge-commit', mergeCommit: sha('4') },
    ];
    expect(ungatedStagingCommits([sha('1'), sha('2'), sha('3'), sha('5')], log)).toEqual([
      sha('3'),
      sha('5'),
    ]);
    expect(ungatedStagingCommits([], log)).toEqual([]);
  });
});

describe('issueFromBranch', () => {
  it("reads the task issue from a builder branch's name (dispatch names it), since GitHub links no issues into staging", () => {
    expect(issueFromBranch('42-sign-in-page')).toBe(42);
    expect(issueFromBranch('staging')).toBeNull();
    expect(issueFromBranch('62-staging/x')).toBeNull();
    expect(issueFromBranch('0-x')).toBeNull();
  });
});

describe('stagingProblems', () => {
  it('refuses to start a builder from a staging that differs from main on a protected path or holds an ungated commit', () => {
    expect(stagingProblems([{ mode: '100644', path: 'apps/web/src/page.tsx' }], [])).toEqual([]);
    expect(stagingProblems([{ mode: '100644', path: '.claude/settings.json' }], [])).toEqual([
      'protected path: .claude/settings.json',
    ]);
    expect(stagingProblems([], ['e'.repeat(40)])).toEqual([
      "a commit on staging that didn't come through the gate: eeeeeee",
    ]);
  });
});

describe('mergeArgs', () => {
  it('merges a batch with a merge commit and keeps staging; squashes and deletes every other branch', () => {
    expect(mergeArgs('batch')).toEqual(['--merge']);
    expect(mergeArgs('staging')).toEqual(['--squash', '--delete-branch']);
    expect(mergeArgs('main')).toEqual(['--squash', '--delete-branch']);
  });
});

describe('toStagingLogEntry (Argus F1, Cerberus F1 on #170)', () => {
  it("keeps a batch's PR and kind, which the gate needs to know which batches merged", () => {
    expect(
      toStagingLogEntry({
        at: 'x',
        pr: 130,
        kind: 'batch',
        result: 'merged',
        base: 'main',
        sha: 's',
      }),
    ).toEqual({ result: 'merged', base: 'main', pr: 130, kind: 'batch' });
    expect(
      toStagingLogEntry({ result: 'merged', base: 'staging', issue: 42, pr: 50, mergeCommit: 'm' }),
    ).toEqual({ result: 'merged', base: 'staging', issue: 42, pr: 50, mergeCommit: 'm' });
    expect(toStagingLogEntry({ result: 'staging-sync', pr: 'x', kind: 7 })).toEqual({
      result: 'staging-sync',
    });
  });
});

/** A `run` that answers by the command's first words and throws for `fail`; every call is kept in `calls`. */
function fakeRun(answers: Record<string, string>, fail: string[] = []) {
  const calls: string[] = [];
  const run = (cmd: string, args: string[]): string => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    if (fail.some((f) => line.includes(f)))
      throw Object.assign(new Error(`Command failed: ${cmd}`), { stderr: 'boom\nmore' });
    const hit = Object.keys(answers).find((key) => line.includes(key));
    return hit === undefined ? '' : (answers[hit] ?? '');
  };
  return { run, calls };
}

describe('readStagingLog', () => {
  it('reads the merge log once, as the typed entries every reader wants, and skips lines that are no entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-state-'));
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    writeFileSync(
      join(dir, 'merges.jsonl'),
      [
        JSON.stringify({ result: 'merge-commit', base: 'staging', mergeCommit: sha('1'), pr: 7 }),
        'not json',
        JSON.stringify({ result: 'merged', base: 'staging', pr: '8', issue: 3 }),
        '',
      ].join('\n'),
    );
    expect(readStagingLog(dir)).toEqual([
      { result: 'merge-commit', base: 'staging', mergeCommit: sha('1'), pr: 7 },
      { result: 'merged', base: 'staging', issue: 3 },
    ]);
  });

  it('reads no log as an empty one', () => {
    expect(readStagingLog(join(tmpdir(), 'lzp-no-such-state-dir'))).toEqual([]);
  });
});

describe('syncStaging', () => {
  const repo = 'o/r';

  it('reports the merge commit GitHub made (201)', () => {
    const { run, calls } = fakeRun({ 'api -X POST': JSON.stringify({ sha: sha('a') }) });
    expect(syncStaging(run, repo)).toEqual({
      ok: true,
      message: 'Merged main into staging as aaaaaaa.',
      entry: { result: 'staging-sync', mergeCommit: sha('a') },
    });
    expect(calls[0]).toContain('repos/o/r/merges');
    expect(calls[0]).toContain('base=staging');
    expect(calls[0]).toContain('head=main');
  });

  it('says staging already contains main when GitHub answers with no body (204)', () => {
    expect(syncStaging(fakeRun({}).run, repo)).toEqual({
      ok: true,
      message: 'staging already contains main.',
      entry: { result: 'staging-sync', mergeCommit: '' },
    });
  });

  it("fails with gh's own first words and a log line that is no sync, so dispatch refuses (409, anything else)", () => {
    const result = syncStaging(fakeRun({}, ['api -X POST']).run, repo);
    expect(result.ok).toBe(false);
    expect(result.entry).toEqual({ result: 'staging-sync-failed' });
    expect(result.message).toBe(
      "Couldn't merge main into staging: boom\nmore. Settle it before dispatching builders.",
    );
  });

  it('fails the same way on an answer that is no JSON, with nothing from stderr to show', () => {
    const result = syncStaging(fakeRun({ 'api -X POST': '<html>' }).run, repo);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Couldn't merge main into staging: unknown.");
  });
});

describe('stagingRefusal', () => {
  const log = [{ result: 'merge-commit', base: 'staging', mergeCommit: sha('1') }];
  const answers = { 'log --first-parent': `${sha('1')}\n` };

  it('fetches staging, and finds nothing wrong when it holds main and only gated commits', () => {
    const { run, calls } = fakeRun(answers);
    expect(stagingRefusal(run, log)).toBeNull();
    expect(calls[0]).toContain('+refs/heads/staging:refs/remotes/origin/staging');
  });

  it("refuses staging that doesn't contain main, before looking at anything else", () => {
    const { run, calls } = fakeRun(answers, ['merge-base --is-ancestor']);
    expect(stagingRefusal(run, log)).toBe(
      "Refused: staging doesn't contain main (the merge gate merges main into staging after each merge into main; settle that first).",
    );
    expect(calls.some((c) => c.includes('diff --raw'))).toBe(false);
  });

  it('refuses a commit on staging that is not in the log', () => {
    const { run } = fakeRun({ 'log --first-parent': `${sha('1')}\n${sha('2')}\n` });
    expect(stagingRefusal(run, log)).toBe(
      "Refused: staging isn't safe to build on:\n- a commit on staging that didn't come through the gate: 2222222",
    );
  });

  it('refuses a protected path that differs from main', () => {
    const raw = `:100644 100644 ${sha('a')} ${sha('b')} M\0.claude/settings.json\0`;
    const { run } = fakeRun({ ...answers, 'diff --raw': raw });
    expect(stagingRefusal(run, log)).toMatch(
      /^Refused: staging isn't safe to build on:\n- .*\.claude/s,
    );
  });
});

describe('auditStaging', () => {
  const log = [{ result: 'staging-sync', mergeCommit: sha('1') }];
  const line = (c: string, subject: string) => `${sha(c)}\t2026-11-20T10:00:00Z\t${subject}`;

  it('reports each first-parent commit on staging the gate did not make', () => {
    const { run } = fakeRun({
      'ls-remote': `${sha('9')}\trefs/heads/staging\n`,
      'log --first-parent': `${line('1', 'Merge main')}\n${line('2', 'sneaky push')}\n`,
    });
    expect(auditStaging(run, log)).toEqual([
      {
        sha: sha('2'),
        at: '2026-11-20T10:00:00Z',
        subject: 'on staging, not through the gate: sneaky push',
      },
    ]);
  });

  it('skips the audit when there is no staging branch at all', () => {
    const { run, calls } = fakeRun({ 'ls-remote': '' });
    expect(auditStaging(run, log)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('makes a failed ls-remote a finding, since then nobody knows whether staging exists (it freezes)', () => {
    const { run } = fakeRun({}, ['ls-remote']);
    const found = auditStaging(run, log, new Date('2026-11-20T12:00:00Z'));
    expect(found).toEqual([
      {
        sha: '',
        at: '2026-11-20T12:00:00.000Z',
        subject: "couldn't audit staging: Command failed: git",
      },
    ]);
  });

  it('makes a failed fetch of an existing staging a finding too', () => {
    const { run } = fakeRun({ 'ls-remote': `${sha('9')}\trefs/heads/staging\n` }, ['fetch']);
    const [found] = auditStaging(run, log, new Date('2026-11-20T12:00:00Z'));
    expect(found?.subject).toBe("couldn't audit staging: Command failed: git");
  });
});

describe('unreadMergeCommitNote', () => {
  it('for staging says dispatch and the batch will refuse it, and gives the log line that fixes it', () => {
    const note = unreadMergeCommitNote('staging', 301, sha('c'));
    expect(note).toContain('dispatch and the batch will refuse staging');
    expect(note).toContain('gh pr view 301 --json mergeCommit');
    expect(note).toContain(
      `"pr":301,"sha":"${sha('c')}","result":"merge-commit","base":"staging","mergeCommit":"<the merge commit>"`,
    );
  });

  it('for main keeps the short note: the weekly audit matches by PR', () => {
    expect(unreadMergeCommitNote('main', 301, sha('c'))).toBe(
      'Merged (the merge commit could not be read back; the weekly audit will match it by PR).',
    );
  });
});
