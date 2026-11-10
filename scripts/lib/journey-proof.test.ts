import { describe, expect, it } from 'vitest';
import { journeyProof, toJourneyEntries, type JourneyEntry } from './journey-proof.ts';

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
