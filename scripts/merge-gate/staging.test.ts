import { describe, expect, it } from 'vitest';
import { issueFromBranch, mergeArgs, stagingProblems, ungatedStagingCommits } from './staging.ts';

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
