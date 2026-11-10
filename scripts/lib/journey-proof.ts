// A feature's journey, proved by CI (§19 step 1, #156): the merge gate holds a feature's batch until the `services` run
// on its head commit shows every journey test of the feature ran and passed. The proof is the journey reporter's
// file (scripts/ci/journey-reporter.ts), not the test's source: Vitest itself says whether a test was marked as
// expected to fail, skipped or todo, however it was written. A test that returns before asserting still passes; the
// batch review, which reads the journey's diff, is the backstop for that.

/** One journey test as the reporter saw it run. */
export interface JourneyEntry {
  /** The test file, relative to the repository's root. */
  file: string;
  name: string;
  /** Vitest's result: `passed`, `failed`, `skipped` or `pending`. */
  state: string;
  /** Marked as expected to fail (`it.fails`, `{ fails: true }`, …): a pass then means the journey still fails. */
  fails: boolean;
  /** `run`, `skip`, `only` or `todo`. */
  mode: string;
}

/** The shape of Vitest's test modules a reporter gets at the end of a run (only what's read here). */
export interface ReporterModule {
  moduleId: string;
  children: {
    allTests: () => Iterable<{
      name: string;
      options: { fails?: boolean; mode?: string };
      result: () => { state: string };
    }>;
  };
}

/** The journey tests (`tests/journeys/…`) in a run, with each one's state and marks. */
export function toJourneyEntries(modules: Iterable<ReporterModule>, root: string): JourneyEntry[] {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  const entries: JourneyEntry[] = [];
  for (const m of modules) {
    const file = m.moduleId.startsWith(prefix) ? m.moduleId.slice(prefix.length) : m.moduleId;
    if (!file.startsWith('tests/journeys/')) continue;
    for (const t of m.children.allTests())
      entries.push({
        file,
        name: t.name,
        state: t.result().state,
        fails: t.options.fails === true,
        mode: t.options.mode ?? 'run',
      });
  }
  return entries;
}

/** Why the report doesn't prove the feature's journey passed, or nothing when it does. */
export function journeyProof(entries: readonly JourneyEntry[] | null, feature: string): string[] {
  if (entries === null)
    return [
      "the services run on this commit left no journey report, so the journey can't be shown to pass",
    ];
  const own = entries.filter(
    (e) =>
      e.file.startsWith(`tests/journeys/${feature}.`) ||
      e.file.startsWith(`tests/journeys/${feature}/`),
  );
  if (own.length === 0)
    return [`no journey test of feature "${feature}" ran in the services run on this commit`];
  return own.flatMap((e) => {
    const which = `journey test "${e.name}" (${e.file})`;
    if (e.fails) return [`${which} is marked as expected to fail`];
    if (e.mode !== 'run' && e.mode !== 'only') return [`${which} didn't run (${e.mode})`];
    if (e.state !== 'passed') return [`${which} ${e.state === 'skipped' ? "didn't run" : e.state}`];
    return [];
  });
}

/** What Playwright's reporter knows of one test when it ends (only what's read here). */
export interface PlaywrightTest {
  /** Absolute path of the test file. */
  file: string;
  titlePath: readonly string[];
  /** `failed` for `test.fail()`. */
  expectedStatus: string;
  annotations: readonly { type: string }[];
  /** This attempt's result: `passed`, `failed`, `timedOut`, `skipped` or `interrupted`. */
  status: string;
}

/** A Playwright journey test as an entry of the same shape as Vitest's, or null outside `tests/journeys/`. */
export function toPlaywrightEntry(t: PlaywrightTest, root: string): JourneyEntry | null {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  const file = t.file.startsWith(prefix) ? t.file.slice(prefix.length) : t.file;
  if (!file.startsWith('tests/journeys/')) return null;
  const off = t.annotations.find((a) => a.type === 'skip' || a.type === 'fixme');
  return {
    file,
    name: t.titlePath.filter((part) => part !== '').join(' › '),
    state: t.status,
    fails: t.expectedStatus === 'failed',
    mode: off?.type ?? 'run',
  };
}

function isEntry(e: unknown): e is JourneyEntry {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.file === 'string' &&
    typeof r.name === 'string' &&
    typeof r.state === 'string' &&
    typeof r.mode === 'string' &&
    typeof r.fails === 'boolean'
  );
}

/**
 * The journey tests in the artifact's files (`vitest.json`, and `playwright.json` once the end-to-end tests run), or
 * why they can't be read. The files come from a run of the batch's code, so they are read as data and checked for
 * shape; a test that forged one would be in the batch's diff, which the batch review reads.
 */
export function parseJourneyReport(
  files: Readonly<Record<string, string>>,
): JourneyEntry[] | string {
  if (files['vitest.json'] === undefined) return 'it has no vitest.json';
  const entries: JourneyEntry[] = [];
  for (const name of ['vitest.json', 'playwright.json']) {
    const text = files[name];
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return `${name} isn't JSON`;
    }
    if (!Array.isArray(parsed) || !parsed.every(isEntry))
      return `${name} is not a list of journey tests`;
    entries.push(...parsed);
  }
  return entries;
}
