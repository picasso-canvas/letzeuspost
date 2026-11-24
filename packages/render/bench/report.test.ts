import { describe, expect, it } from 'vitest';
import { formatReport, overallP95, type BenchResult } from './report.ts';

const MB = 1024 * 1024;

const result = (overrides: Partial<BenchResult> = {}): BenchResult => ({
  slides: [
    { size: 'portrait', ms: 400, startedBrowser: false },
    { size: 'portrait', ms: 600, startedBrowser: false },
    { size: 'story', ms: 2_000, startedBrowser: false },
    { size: 'story', ms: 900, startedBrowser: false },
    { size: 'story', ms: 3_500, startedBrowser: true },
  ],
  totalMs: 125_400,
  browserStarts: 3,
  memory: {
    samples: [
      { render: 1, bytes: 300 * MB },
      { render: 2, bytes: 450 * MB },
    ],
    peakBytes: 450 * MB,
    finalBytes: 420 * MB,
  },
  ...overrides,
});

describe('formatReport', () => {
  const text = formatReport(result());

  it('prints p50, p95 and max for each size, in ms', () => {
    expect(text).toMatch(/portrait\s+2\s+400\s+600\s+600/);
    expect(text).toMatch(/story\s+2\s+900\s+2000\s+2000/);
  });

  it('leaves out the renders that started a browser, and says so, with the slowest', () => {
    expect(text).toMatch(/1 render started a browser.*3500 ms/);
  });

  it('prints the total time, the peak and final memory and the restarts', () => {
    expect(text).toMatch(/total time\s+2 min 5\.4 s/);
    expect(text).toMatch(/peak memory\s+450 MB/);
    expect(text).toMatch(/final memory\s+420 MB/);
    expect(text).toMatch(/browser restarts\s+2/);
  });

  it('says where the 1.5 s target stands for each size, as a note and never a failure', () => {
    expect(text).toMatch(/portrait.*within/);
    expect(text).toMatch(/story.*over/);
  });

  it('says memory could not be read when it could not', () => {
    const none = formatReport(result({ memory: { samples: [] } }));
    expect(none).toMatch(/peak memory\s+not readable/);
    expect(none).toMatch(/final memory\s+not readable/);
  });

  it('counts no restart for a browser that only started once', () => {
    expect(formatReport(result({ browserStarts: 1 }))).toMatch(/browser restarts\s+0/);
  });
});

describe('overallP95', () => {
  it('is the 95th percentile of all the renders that did not start a browser', () => {
    expect(overallP95(result())).toBe(2_000);
  });
});
