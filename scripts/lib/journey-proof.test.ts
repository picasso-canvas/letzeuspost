import { describe, expect, it } from 'vitest';
import {
  journeyProof,
  parseJourneyReport,
  toJourneyEntries,
  toPlaywrightEntry,
  type JourneyEntry,
} from './journey-proof.ts';

const entry = (over: Partial<JourneyEntry> = {}): JourneyEntry => ({
  file: 'tests/journeys/data.int.test.ts',
  name: 'two workspaces stay apart',
  state: 'passed',
  fails: false,
  mode: 'run',
  ...over,
});

describe('journeyProof (#156)', () => {
  it("passes when every one of the feature's journey tests ran and passed", () => {
    expect(
      journeyProof([entry(), entry({ file: 'tests/journeys/data/flow.int.test.ts' })], 'data'),
    ).toEqual([]);
  });

  it('refuses a journey marked as expected to fail, skipped or todo, however it was written', () => {
    expect(journeyProof([entry({ fails: true })], 'data')).toEqual([
      'journey test "two workspaces stay apart" (tests/journeys/data.int.test.ts) is marked as expected to fail',
    ]);
    expect(journeyProof([entry({ state: 'skipped', mode: 'skip' })], 'data')).toEqual([
      'journey test "two workspaces stay apart" (tests/journeys/data.int.test.ts) didn\'t run (skip)',
    ]);
    expect(journeyProof([entry({ state: 'skipped', mode: 'todo' })], 'data')).toEqual([
      'journey test "two workspaces stay apart" (tests/journeys/data.int.test.ts) didn\'t run (todo)',
    ]);
    expect(journeyProof([entry({ state: 'failed' })], 'data')).toEqual([
      'journey test "two workspaces stay apart" (tests/journeys/data.int.test.ts) failed',
    ]);
  });

  it("refuses when no journey test of the feature ran, or there's no report at all", () => {
    expect(journeyProof([entry({ file: 'tests/journeys/sign-in.spec.ts' })], 'data')).toEqual([
      'no journey test of feature "data" ran in the services run on this commit',
    ]);
    expect(
      journeyProof([entry({ file: 'tests/journeys/data-export.int.test.ts' })], 'data'),
    ).toHaveLength(1);
    expect(journeyProof(null, 'data')).toEqual([
      "the services run on this commit left no journey report, so the journey can't be shown to pass",
    ]);
  });
});

describe('toJourneyEntries (what the reporter writes)', () => {
  const test = (name: string, state: string, options: { fails?: boolean; mode?: string } = {}) => ({
    name,
    options,
    result: () => ({ state }),
  });
  const module = (moduleId: string, tests: ReturnType<typeof test>[]) => ({
    moduleId,
    children: { allTests: () => tests },
  });

  it("keeps only the journey tests, repo-relative, with each one's state and marks", () => {
    expect(
      toJourneyEntries(
        [
          module('/w/repo/tests/journeys/data.int.test.ts', [
            test('a', 'passed'),
            test('b', 'passed', { fails: true, mode: 'run' }),
            test('c', 'skipped', { mode: 'todo' }),
          ]),
          module('/w/repo/packages/db/src/rls.int.test.ts', [test('d', 'passed')]),
        ],
        '/w/repo',
      ),
    ).toEqual([
      {
        file: 'tests/journeys/data.int.test.ts',
        name: 'a',
        state: 'passed',
        fails: false,
        mode: 'run',
      },
      {
        file: 'tests/journeys/data.int.test.ts',
        name: 'b',
        state: 'passed',
        fails: true,
        mode: 'run',
      },
      {
        file: 'tests/journeys/data.int.test.ts',
        name: 'c',
        state: 'skipped',
        fails: false,
        mode: 'todo',
      },
    ]);
  });
});

describe('toPlaywrightEntry (what the Playwright reporter writes)', () => {
  const pw = (over: Partial<Parameters<typeof toPlaywrightEntry>[0]> = {}) =>
    toPlaywrightEntry(
      {
        file: '/w/repo/tests/journeys/sign-in.spec.ts',
        titlePath: ['', 'app-light', 'sign-in.spec.ts', 'signs in with a magic link'],
        expectedStatus: 'passed',
        annotations: [],
        status: 'passed',
        ...over,
      },
      '/w/repo',
    );

  it('reads a journey test as Vitest would: state, expected to fail, skipped', () => {
    expect(pw()).toEqual({
      file: 'tests/journeys/sign-in.spec.ts',
      name: 'app-light › sign-in.spec.ts › signs in with a magic link',
      state: 'passed',
      fails: false,
      mode: 'run',
    });
    // `test.fail()`: Playwright expects it to fail, so a pass is no proof.
    expect(pw({ expectedStatus: 'failed', annotations: [{ type: 'fail' }] })?.fails).toBe(true);
    expect(pw({ annotations: [{ type: 'skip' }], status: 'skipped' })).toMatchObject({
      mode: 'skip',
      state: 'skipped',
    });
    expect(pw({ annotations: [{ type: 'fixme' }], status: 'skipped' })?.mode).toBe('fixme');
    expect(pw({ status: 'timedOut' })?.state).toBe('timedOut');
  });

  it('leaves out a test outside tests/journeys/', () => {
    expect(pw({ file: '/w/repo/tests/e2e/home.spec.ts' })).toBeNull();
  });
});

describe('parseJourneyReport (the artifact the gate downloads)', () => {
  const one = JSON.stringify([entry()]);

  it("reads Vitest's file, and Playwright's when there is one", () => {
    expect(parseJourneyReport({ 'vitest.json': one })).toEqual([entry()]);
    expect(
      parseJourneyReport({
        'vitest.json': one,
        'playwright.json': JSON.stringify([entry({ file: 'tests/journeys/data.spec.ts' })]),
      }),
    ).toHaveLength(2);
  });

  it("says why a report can't be read: no Vitest file, not JSON, or an entry of the wrong shape", () => {
    expect(parseJourneyReport({})).toBe('it has no vitest.json');
    expect(parseJourneyReport({ 'vitest.json': 'nope' })).toBe("vitest.json isn't JSON");
    for (const bad of ['{}', '[{"file":1}]', JSON.stringify([{ ...entry(), fails: 'no' }])])
      expect(parseJourneyReport({ 'vitest.json': bad })).toBe(
        'vitest.json is not a list of journey tests',
      );
  });
});
