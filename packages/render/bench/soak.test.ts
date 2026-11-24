import { describe, expect, it } from 'vitest';
import { SOAK_BASELINE_RENDERS, SOAK_MARGIN } from './config.ts';
import { checkSoak, type MemorySample } from './soak.ts';

const MB = 1024 * 1024;

/** A sample after each render from 1 to `renders`, the memory following `bytes(render)`. */
const series = (renders: number, bytes: (render: number) => number): MemorySample[] =>
  Array.from({ length: renders }, (_, i) => ({ render: i + 1, bytes: bytes(i + 1) }));

describe('checkSoak', () => {
  it('passes flat memory', () => {
    const verdict = checkSoak(series(1000, () => 400 * MB));
    expect(verdict).toMatchObject({ ok: true, baselineBytes: 400 * MB, finalBytes: 400 * MB });
  });

  it('measures from the sample after the 50th render to the last one', () => {
    const verdict = checkSoak(series(1000, (render) => (render <= 49 ? 100 : 400) * MB));
    expect(verdict.baselineBytes).toBe(400 * MB);
    expect(verdict.limitBytes).toBe(400 * MB * (1 + SOAK_MARGIN));
  });

  it('passes growth up to the margin and fails one byte past it', () => {
    const baseline = 400 * MB;
    const limit = baseline * (1 + SOAK_MARGIN);
    const at = (final: number) =>
      checkSoak(series(1000, (render) => (render === 1000 ? final : baseline)));
    expect(at(limit).ok).toBe(true);
    const over = at(limit + 1);
    expect(over.ok).toBe(false);
    expect(over.message).toMatch(/grew from 400 MB to 500 MB/);
    expect(over.message).toMatch(/limit 500 MB/);
  });

  it('fails a steady leak, a megabyte a render', () => {
    const verdict = checkSoak(series(1000, (render) => 300 * MB + render * MB));
    expect(verdict.ok).toBe(false);
  });

  it('fails when the run was shorter than the baseline, because it proves nothing', () => {
    const verdict = checkSoak(series(SOAK_BASELINE_RENDERS - 1, () => 400 * MB));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/after the first 50 renders/);
  });

  it('fails when the browser’s memory could not be read', () => {
    const verdict = checkSoak([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/memory could not be read/);
  });

  it('uses the first sample at or after the baseline when the 50th has none', () => {
    const samples = series(200, (render) => (render >= 52 ? 400 : 100) * MB).filter(
      (sample) => sample.render !== 50 && sample.render !== 51,
    );
    expect(checkSoak(samples).baselineBytes).toBe(400 * MB);
  });
});
