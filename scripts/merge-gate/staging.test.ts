import { describe, expect, it } from 'vitest';
import { ungatedStagingCommits } from './staging.ts';

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
