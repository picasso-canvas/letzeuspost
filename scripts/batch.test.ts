import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import { batchBody, taskPrs } from './batch.ts';

describe('taskPrs', () => {
  it("reads the gate's squash subjects on staging, oldest first, and skips main's merges into staging", () => {
    const log = [
      '[M0] Seed command (#71)',
      'Merge main into staging (merge gate)',
      '[M0] Workspaces and roles (#70)',
      'a commit without a PR number',
      '',
    ].join('\n');
    expect(taskPrs(log)).toEqual([70, 71]);
  });
});

describe('batchBody', () => {
  it('closes every task issue and ticks a task only when the gate merged it into staging', () => {
    const body = batchBody([
      { pr: 70, title: '[M0] Workspaces and roles', issues: [64], gated: true },
      { pr: 71, title: '[M0] Seed command', issues: [65, 66], gated: false },
    ]);
    expect(body).toContain('Closes #64\nCloses #65\nCloses #66\n');
    expect(body).toContain('- [x] #64 (PR #70): merged into staging through the gate');
    expect(body).toContain('- [ ] #65 (PR #71): not found in the merge log as merged into staging');
    expect(body).toContain('- [ ] #66 (PR #71): not found in the merge log as merged into staging');
  });
});

describe('the second batch (#63 review)', () => {
  it("doesn't count the first batch's tasks again, because a batch merges into main with a merge commit", () => {
    const repo = mkdtempSync(join(tmpdir(), 'lzp-batch-'));
    onTestFinished(() => {
      rmSync(repo, { recursive: true, force: true });
    });
    const git = (args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: repo,
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
    const task = (file: string, subject: string) => {
      writeFileSync(join(repo, file), file);
      git(['add', file]);
      git(['commit', '--quiet', '-m', subject]);
    };
    git(['init', '--quiet', '-b', 'main']);
    task('base.txt', 'base');
    git(['checkout', '--quiet', '-b', 'staging']);
    task('a.ts', '[M0] A (#70)');
    task('b.ts', '[M0] B (#71)');
    git(['checkout', '--quiet', 'main']);
    git(['merge', '--quiet', '--no-ff', '-m', '[Batch] 2 tasks (#72)', 'staging']);
    git(['checkout', '--quiet', 'staging']);
    git(['merge', '--quiet', '--no-edit', 'main']);
    task('c.ts', '[M0] C (#73)');
    expect(taskPrs(git(['log', '--first-parent', '--format=%s', 'main..staging']))).toEqual([73]);
  });
});
