import { describe, expect, it } from 'vitest';
import {
  dispatchRefusal,
  featureBatch,
  featureOf,
  followUpOf,
  journeyMarked,
  type TaskIssue,
} from './features.ts';

const task = (number: number, labels: string[], over: Partial<TaskIssue> = {}): TaskIssue => ({
  number,
  labels: ['build-task', ...labels],
  milestone: 'M0',
  body: '**Goal:** x',
  ...over,
});
const mergedBatches = new Set([130]);
const isMergedBatch = (pr: number) => mergedBatches.has(pr);

describe('featureOf', () => {
  it("reads a task's feature from its label, and refuses two", () => {
    expect(featureOf(['build-task', 'feature:data'])).toBe('data');
    expect(featureOf(['build-task'])).toBeNull();
    expect(() => featureOf(['feature:data', 'feature:sign-in'])).toThrow(/two features/);
  });
});

describe('followUpOf', () => {
  it('reads the batch PR a follow-up names', () => {
    expect(
      followUpOf('**Goal:** x\n\n**Follow-up of:** #130 (lands before the next batch merges)'),
    ).toBe(130);
    expect(followUpOf('**Goal:** x')).toBeNull();
  });
});

describe('dispatchRefusal', () => {
  const data = task(71, ['feature:data']);

  it('lets a task of the open feature through, alongside its feature mates', () => {
    expect(dispatchRefusal(data, [task(150, ['feature:data'])], isMergedBatch)).toBeNull();
    expect(dispatchRefusal(data, [], isMergedBatch)).toBeNull();
  });

  it('refuses a task of another feature while one is open, naming the open tasks', () => {
    expect(
      dispatchRefusal(task(75, ['feature:app-shell']), [task(71, ['feature:data'])], isMergedBatch),
    ).toBe('feature "data" is open (#71): #75 of feature "app-shell" waits until its batch merges');
  });

  it('lets a follow-up of a merged batch through at any time, but not the label alone', () => {
    const real = task(144, ['follow-up'], { body: '**Follow-up of:** #130' });
    expect(dispatchRefusal(real, [data], isMergedBatch)).toBeNull();
    const labelOnly = task(160, ['follow-up'], { body: '**Goal:** x' });
    expect(dispatchRefusal(labelOnly, [data], isMergedBatch)).toBe(
      '#160 is labelled follow-up but its **Follow-up of:** line names no batch PR merged into main',
    );
    const notABatch = task(161, ['follow-up'], { body: '**Follow-up of:** #152' });
    expect(dispatchRefusal(notABatch, [data], isMergedBatch)).toMatch(/names no batch PR merged/);
  });

  it('refuses a task with no feature from M0 on, but not a harness task', () => {
    expect(dispatchRefusal(task(90, []), [], isMergedBatch)).toBe(
      '#90 has no feature:<slug> label: Athena labels it first (§19)',
    );
    expect(
      dispatchRefusal(task(33, [], { milestone: 'H0 Harness' }), [data], isMergedBatch),
    ).toBeNull();
  });

  it("exempts a harness task even when it's a follow-up of a harness PR, not of a batch", () => {
    const harnessFollowUp = task(148, ['follow-up'], {
      milestone: 'H0 Harness',
      body: '**Follow-up of:** #146, #119, #152',
    });
    expect(dispatchRefusal(harnessFollowUp, [data], isMergedBatch)).toBeNull();
  });

  it('refuses a task with two feature labels', () => {
    expect(
      dispatchRefusal(task(72, ['feature:data', 'feature:sign-in']), [], isMergedBatch),
    ).toMatch(/two features/);
  });
});

describe('journeyMarked', () => {
  it("finds an expected-failure mark in the feature's own journey test, in Vitest or Playwright form", () => {
    const files = [
      { path: 'tests/journeys/data.int.test.ts', text: "it.fails('the journey', async () => {})" },
      { path: 'tests/journeys/sign-in.spec.ts', text: "test.fail();\ntest('sign in', () => {})" },
      { path: 'tests/journeys/workspaces.spec.ts', text: "test('switch', () => {})" },
    ];
    expect(journeyMarked(files, 'data')).toBe(true);
    expect(journeyMarked(files, 'sign-in')).toBe(true);
    expect(journeyMarked(files, 'workspaces')).toBe(false);
    expect(journeyMarked(files, 'data-export')).toBe(false); // another feature's prefix doesn't count
  });
});

describe('featureBatch', () => {
  const issues = {
    150: task(150, ['feature:data']),
    71: task(71, ['feature:data']),
    144: task(144, ['follow-up'], { body: '**Follow-up of:** #130' }),
  };
  const base = {
    onStaging: [150, 71, 144],
    issues,
    featureTasks: [150, 71],
    journeyMarked: false,
    lines: 400,
  };

  it('opens the batch when every task of the open feature is on staging and its journey is unmarked', () => {
    expect(featureBatch(base)).toEqual({
      due: true,
      feature: 'data',
      reason: 'every task of feature "data" is on staging (#150, #71)',
    });
  });

  it("waits for the feature's missing tasks, and for the journey mark to go", () => {
    expect(featureBatch({ ...base, featureTasks: [150, 71, 72, 73] })).toEqual({
      due: false,
      feature: 'data',
      reason: 'feature "data" still needs #72, #73 on staging',
    });
    expect(featureBatch({ ...base, journeyMarked: true })).toEqual({
      due: false,
      feature: 'data',
      reason: 'feature "data"\'s journey test is still marked as expected to fail',
    });
  });

  it('opens a part of a feature that outgrows the size cap', () => {
    expect(featureBatch({ ...base, featureTasks: [150, 71, 72], lines: 1600 })).toEqual({
      due: true,
      feature: 'data',
      reason: 'staging is 1600 changed lines ahead: a part of feature "data"',
    });
  });

  it('opens a batch of follow-ups on their own when no feature is on staging', () => {
    expect(featureBatch({ ...base, onStaging: [144], featureTasks: [] })).toEqual({
      due: true,
      feature: null,
      reason: 'staging holds only follow-ups (#144)',
    });
  });

  it('refuses to open while staging holds two features, and has nothing to open when empty', () => {
    expect(
      featureBatch({
        ...base,
        issues: { ...issues, 75: task(75, ['feature:app-shell']) },
        onStaging: [150, 75],
      }),
    ).toEqual({ due: false, feature: null, reason: 'staging holds two features: data, app-shell' });
    expect(featureBatch({ ...base, onStaging: [], featureTasks: [] })).toEqual({
      due: false,
      feature: null,
      reason: 'staging holds no task',
    });
  });
});
