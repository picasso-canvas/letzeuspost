import { SOAK_BASELINE_RENDERS, SOAK_MARGIN } from './config.ts';

/** The browser's memory, in bytes, once `render` renders were done (counting from 1). */
export type MemorySample = { render: number; bytes: number };

export type SoakVerdict = {
  ok: boolean;
  baselineBytes?: number;
  finalBytes?: number;
  limitBytes?: number;
  message: string;
};

const MB = 1024 * 1024;
const mb = (bytes: number): string => `${String(Math.round(bytes / MB))} MB`;

/**
 * The soak's verdict (§08: 1,000 renders in a row don't grow memory): the last sample may be at most
 * `SOAK_MARGIN` above the first one taken after `SOAK_BASELINE_RENDERS` renders. A run that can't show that (no memory
 * readings, or fewer renders than the baseline) fails, so a broken probe never reads as a pass.
 */
export function checkSoak(samples: readonly MemorySample[]): SoakVerdict {
  if (samples.length === 0)
    return {
      ok: false,
      message: 'The browser’s memory could not be read, so the soak proves nothing',
    };
  const baseline = samples.find((sample) => sample.render >= SOAK_BASELINE_RENDERS);
  const last = samples.at(-1);
  if (baseline === undefined || last === undefined)
    return {
      ok: false,
      message: `The run ended before there was a memory reading after the first ${String(SOAK_BASELINE_RENDERS)} renders`,
    };
  const limitBytes = baseline.bytes * (1 + SOAK_MARGIN);
  const ok = last.bytes <= limitBytes;
  const verdict = `memory after render ${String(last.render)} is ${mb(last.bytes)}; after render ${String(baseline.render)} it was ${mb(baseline.bytes)}, limit ${mb(limitBytes)} (+${String(SOAK_MARGIN * 100)}%)`;
  return {
    ok,
    baselineBytes: baseline.bytes,
    finalBytes: last.bytes,
    limitBytes,
    message: ok
      ? `Memory held: ${verdict}`
      : `Memory grew from ${mb(baseline.bytes)} to ${mb(last.bytes)}: ${verdict}`,
  };
}
