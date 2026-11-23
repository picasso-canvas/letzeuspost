// The worker's timers (#210, reused by #323): scheduled work with no queue and no job (Zeus, option D on #322), since
// pg-boss's cron pass can't start as the app role. Every worker runs its own, which is harmless: what a timer runs
// must be safe to run twice.
import { randomUUIDv7 } from 'node:crypto';
import type { Log } from './log.ts';

/** One run; `runId` names the run in the log. */
export type Run = (run: { readonly runId: string }) => Promise<void>;

export interface Timer {
  /** No run starts after this; resolves once the run in flight, if any, has ended. */
  readonly stop: () => Promise<void>;
}

/** An error's name, for a log line: a database error's message may quote a statement. */
export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown';

/**
 * Runs `run` every `everyMs`, the first one interval after the start, and never two at once: a tick that finds a run
 * still going is skipped. A failed run is logged as `failedEvent`, by its error's name only, and the next tick tries
 * again.
 */
export function every(everyMs: number, failedEvent: string, run: Run, log: Log): Timer {
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    const runId = randomUUIDv7();
    running = run({ runId })
      .catch((error: unknown) => {
        log(failedEvent, { runId, error: errorName(error) });
      })
      .finally(() => {
        running = undefined;
      });
  }, everyMs);
  // The queue keeps the worker alive; the timer alone never holds the process open.
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}
