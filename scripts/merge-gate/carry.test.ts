import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { changeId, selectReviews } from './carry.ts';
import type { ReviewRecord } from './types.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

function rec(
  reviewer: ReviewRecord['reviewer'],
  sha: string,
  verdict: 'pass' | 'block',
): ReviewRecord {
  return { pr: 7, sha, reviewer, verdict, bodyHash: 'h', summary: `VERDICT: ${verdict}`, at: '' };
}

describe('selectReviews', () => {
  it("uses a reviewer's records at the head when there are any", () => {
    const current = [rec('argus', C, 'pass')];
    const earlier = [{ sha: B, records: [rec('argus', B, 'block')] }];
    expect(selectReviews(C, current, earlier)).toEqual([rec('argus', C, 'pass')]);
  });

  it("otherwise carries that reviewer's records from the newest earlier head with the same change, blocks too", () => {
    const earlier = [
      { sha: B, records: [rec('argus', B, 'pass'), rec('cerberus', B, 'block')] },
      { sha: A, records: [rec('argus', A, 'block'), rec('redteam', A, 'pass')] },
    ];
    expect(selectReviews(C, [], earlier)).toEqual([
      { ...rec('argus', B, 'pass'), sha: C, carriedFrom: B },
      { ...rec('cerberus', B, 'block'), sha: C, carriedFrom: B },
      { ...rec('redteam', A, 'pass'), sha: C, carriedFrom: A },
    ]);
  });
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
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

describe('changeId', () => {
  it("stays the same when main is merged in and doesn't touch the PR's files; changes when it does", () => {
    const repo = mkdtempSync(join(tmpdir(), 'lzp-carry-'));
    onTestFinished(() => {
      rmSync(repo, { recursive: true, force: true });
    });
    const run = (args: string[]) => git(repo, args);
    const commit = (file: string, text: string, message: string) => {
      writeFileSync(join(repo, file), text);
      run(['add', file]);
      run(['commit', '--quiet', '-m', message]);
      return run(['rev-parse', 'HEAD']).trim();
    };
    run(['init', '--quiet', '-b', 'main']);
    commit('base.txt', 'base\n', 'base');
    run(['checkout', '--quiet', '-b', 'pr']);
    const reviewed = commit('feature.ts', 'export const a = 1;\n', 'feature');
    run(['checkout', '--quiet', 'main']);
    commit('other.txt', 'main moved\n', 'main moves elsewhere');
    run(['update-ref', 'refs/remotes/origin/main', 'main']);
    run(['checkout', '--quiet', 'pr']);
    run(['merge', '--quiet', '--no-edit', 'main']);
    const updated = run(['rev-parse', 'HEAD']).trim();
    expect(updated).not.toBe(reviewed);
    expect(changeId(run, updated)).toBe(changeId(run, reviewed));

    const edited = commit('feature.ts', 'export const a = 2;\n', 'a real change');
    expect(changeId(run, edited)).not.toBe(changeId(run, reviewed));

    // main changing the PR's own file changes its base blob: the change is re-reviewed
    run(['checkout', '--quiet', 'main']);
    commit('feature.ts', 'export const a = 0;\n', 'main touches the same file');
    run(['update-ref', 'refs/remotes/origin/main', 'main']);
    run(['checkout', '--quiet', 'pr']);
    run(['merge', '--quiet', '--no-edit', '-X', 'ours', 'main']);
    const remerged = run(['rev-parse', 'HEAD']).trim();
    expect(changeId(run, remerged)).not.toBe(changeId(run, edited));
  });
});
