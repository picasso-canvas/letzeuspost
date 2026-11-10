// The journey reporters (#156): CI's `services` job adds them to Vitest's and Playwright's reporters. At the end of a
// run each writes every journey test (`tests/journeys/…`), with its state and whether it was marked as expected to
// fail, skipped or todo, into the folder named by LZP_JOURNEY_DIR (`vitest.json`, `playwright.json`). The job gives
// each runner its own folder and uploads it right after the runner's step (`journeys-vitest`, `journeys-playwright`),
// and the merge gate reads them. They live under scripts/, which builders can't change.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  toJourneyEntries,
  toPlaywrightEntry,
  type JourneyEntry,
  type PlaywrightTest,
  type ReporterModule,
} from '../lib/journey-proof.ts';

function write(name: string, entries: readonly JourneyEntry[]): void {
  const dir = process.env.LZP_JOURNEY_DIR;
  if (dir === undefined || dir === '') return;
  writeFileSync(join(dir, name), `${JSON.stringify(entries, null, 2)}\n`);
}

/** Vitest's reporter. */
export default class VitestJourneyReporter {
  onTestRunEnd(testModules: readonly ReporterModule[]): void {
    write('vitest.json', toJourneyEntries(testModules, process.cwd()));
  }
}

/** Playwright's reporter: the last attempt of each test counts, so a retry that passes replaces the failure. */
export class PlaywrightJourneyReporter {
  private readonly last = new Map<string, JourneyEntry>();

  onTestEnd(
    test: Omit<PlaywrightTest, 'file' | 'titlePath' | 'status'> & {
      id: string;
      location: { file: string };
      titlePath: () => string[];
    },
    result: { status: string },
  ): void {
    const entry = toPlaywrightEntry(
      {
        file: test.location.file,
        titlePath: test.titlePath(),
        expectedStatus: test.expectedStatus,
        annotations: test.annotations,
        status: result.status,
      },
      process.cwd(),
    );
    if (entry !== null) this.last.set(test.id, entry);
  }

  onEnd(): void {
    write('playwright.json', [...this.last.values()]);
  }
}
