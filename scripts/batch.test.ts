import { describe, expect, it } from 'vitest';
import { batchBody, batchDue, taskPrs } from './batch.ts';

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

describe('batchDue', () => {
  it('is due at 5 tasks or 1,500 changed lines, whichever comes first (Zeus, 2026-11-07)', () => {
    expect(batchDue(4, 1499)).toBe(false);
    expect(batchDue(5, 10)).toBe(true);
    expect(batchDue(1, 1500)).toBe(true);
    expect(batchDue(0, 0)).toBe(false);
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
