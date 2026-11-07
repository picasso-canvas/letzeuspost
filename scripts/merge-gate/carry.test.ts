import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { changeId, reviewsAt, selectReviews } from './carry.ts';
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

describe('reviewsAt', () => {
  const at = (n: number) => new Date(Date.UTC(2026, 10, 7, 12, n)).toISOString();
  const r = (
    reviewer: ReviewRecord['reviewer'],
    sha: string,
    verdict: 'pass' | 'block',
    minute: number,
  ) => ({
    ...rec(reviewer, sha, verdict),
    at: at(minute),
  });
  // C is the head. ids: a1 for A and C (same change), b2 for B.
  const ids: Record<string, string> = { [A]: 'a1', [B]: 'b2', [C]: 'a1' };
  const deps = (store: Record<string, ReviewRecord[]>, verified: string[] = []) => ({
    readReviews: (_pr: number, sha: string) => store[sha] ?? [],
    listReviewedShas: () => Object.keys(store),
    changeId: (sha: string) => {
      const id = ids[sha];
      if (id === undefined) throw new Error('git cannot read it');
      return id;
    },
    // Records the commit each record was verified against, so the test can see it's the record's own.
    verify: (record: ReviewRecord, sha: string) => {
      verified.push(`${record.reviewer}@${sha.slice(0, 1)}`);
      return { ...record, meta: { agent: 'x', sessionId: 's', verified: record.sha === sha } };
    },
  });

  it('carries the newest same-change reviews to the head, each verified at its own commit', () => {
    const verified: string[] = [];
    const out = reviewsAt(7, C, deps({ [A]: [r('argus', A, 'pass', 1)] }, verified));
    expect(out.map((x) => [x.reviewer, x.sha, x.carriedFrom, x.meta?.verified])).toEqual([
      ['argus', C, A, true],
    ]);
    expect(verified).toEqual(['argus@a']);
  });

  it('carries nothing when the newest reviewed commit is a different change (a block there must stand)', () => {
    const store = { [A]: [r('cerberus', A, 'pass', 1)], [B]: [r('cerberus', B, 'block', 2)] };
    expect(reviewsAt(7, C, deps(store))).toEqual([]);
  });

  it('carries only the run of same-change commits newer than any other change', () => {
    const D = 'd'.repeat(40);
    ids[D] = 'a1';
    const store = {
      [A]: [r('argus', A, 'pass', 1), r('redteam', A, 'pass', 1)],
      [B]: [r('argus', B, 'block', 2)],
      [D]: [r('argus', D, 'pass', 3)],
    };
    expect(reviewsAt(7, C, deps(store)).map((x) => [x.reviewer, x.carriedFrom])).toEqual([
      ['argus', D],
    ]);
  });

  it("carries nothing from a commit git can't read, or when a record's time doesn't parse", () => {
    const E = 'e'.repeat(40);
    expect(reviewsAt(7, C, deps({ [E]: [r('argus', E, 'pass', 1)] }))).toEqual([]);
    const bad = { ...r('argus', A, 'pass', 1), at: '' };
    expect(reviewsAt(7, C, deps({ [A]: [bad] }))).toEqual([]);
  });

  it('judges a reviewer with records at the head on those alone', () => {
    const store = { [A]: [r('argus', A, 'pass', 1)], [C]: [r('argus', C, 'block', 2)] };
    expect(reviewsAt(7, C, deps(store)).map((x) => [x.verdict, x.carriedFrom])).toEqual([
      ['block', undefined],
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
