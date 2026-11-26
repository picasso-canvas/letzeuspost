import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  formatCosts,
  logCost,
  readCosts,
  summariseCosts,
  usageFromJson,
  usageFromStream,
  usageOf,
  type CostEntry,
  type Usage,
} from './cost.ts';

const result = {
  type: 'result',
  subtype: 'success',
  total_cost_usd: 0.42,
  num_turns: 7,
  duration_ms: 12000,
  usage: {
    input_tokens: 100,
    output_tokens: 200,
    cache_read_input_tokens: 3000,
    cache_creation_input_tokens: 400,
  },
};

const usage = (costUsd: number | null, out = 10): Usage => ({
  costUsd,
  inputTokens: 1,
  outputTokens: out,
  cacheReadTokens: 2,
  cacheCreationTokens: 3,
  turns: 1,
  durationMs: 1,
});
const entry = (stage: CostEntry['stage'], u: Usage, at = '2026-11-20T00:00:00Z'): CostEntry => ({
  at,
  stage,
  model: null,
  usage: u,
});

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lzp-cost-'));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

describe('usageOf', () => {
  it("reads a result event's cost, tokens, turns and duration", () => {
    expect(usageOf(result)).toEqual({
      costUsd: 0.42,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 3000,
      cacheCreationTokens: 400,
      turns: 7,
      durationMs: 12000,
    });
  });

  it('keeps a missing cost as null, and a missing or bad count as 0', () => {
    expect(usageOf({ type: 'result', usage: { input_tokens: -1, output_tokens: 'x' } })).toEqual({
      costUsd: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 0,
      durationMs: 0,
    });
  });

  it('ignores anything that is not a result event', () => {
    expect(usageOf({ type: 'assistant' })).toBeNull();
    expect(usageOf(null)).toBeNull();
    expect(usageOf('result')).toBeNull();
  });
});

describe('usageFromJson / usageFromStream', () => {
  it('reads a reviewer run, even one that errored, and nothing from text that is no JSON', () => {
    expect(usageFromJson(JSON.stringify({ ...result, is_error: true }))?.costUsd).toBe(0.42);
    expect(usageFromJson('not json')).toBeNull();
  });

  it("takes the last result event of a builder's stream, skipping a first line cut mid-way", () => {
    const log = [
      '..., "cut": true}',
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ ...result, total_cost_usd: 1 }),
      JSON.stringify({ ...result, total_cost_usd: 2 }),
      '',
    ].join('\n');
    expect(usageFromStream(log)?.costUsd).toBe(2);
    expect(usageFromStream('{"type":"assistant"}\n')).toBeNull();
  });
});

describe('logCost and readCosts', () => {
  it('appends one line per run and reads them back oldest first, skipping lines that are no entry', () => {
    const dir = stateDir();
    logCost(entry('argus', usage(1)), dir);
    logCost(entry('builder', usage(2)), dir);
    writeFileSync(join(dir, 'costs.jsonl'), 'not json\n{"stage":"argus"}\n', { flag: 'a' });
    expect(readCosts(dir).map((e) => e.stage)).toEqual(['argus', 'builder']);
  });

  it('reads no log as an empty one', () => {
    expect(readCosts(join(tmpdir(), 'lzp-no-such-cost-dir'))).toEqual([]);
  });

  it('reports a log it cannot write, and never throws (a review must not fail for it)', () => {
    const dir = stateDir();
    writeFileSync(join(dir, 'file'), '');
    expect(() => {
      logCost(entry('iris', usage(1)), join(dir, 'file', 'under-a-file'));
    }).not.toThrow();
  });
});

describe('summariseCosts', () => {
  const entries = [
    entry('cerberus', usage(1.5)),
    entry('argus', usage(0.5)),
    entry('argus', usage(null)),
    entry('argus', usage(1), '2026-10-01T00:00:00Z'),
  ];

  it('sums per stage in stage order, then a total, and counts runs with no cost', () => {
    const rows = summariseCosts(entries);
    expect(rows.map((r) => r.stage)).toEqual(['argus', 'cerberus', 'total']);
    expect(rows[0]).toMatchObject({ runs: 3, costUsd: 1.5, noCost: 1, outputTokens: 30 });
    expect(rows[2]).toMatchObject({ runs: 4, costUsd: 3, noCost: 1 });
  });

  it('drops entries before --since', () => {
    expect(summariseCosts(entries, '2026-11-01').at(-1)).toMatchObject({ runs: 3, costUsd: 2 });
  });

  it('has just a zero total for no entries', () => {
    expect(summariseCosts([])).toEqual([expect.objectContaining({ stage: 'total', runs: 0 })]);
  });
});

describe('formatCosts', () => {
  it('prints one line per row with the average, and flags a floor when runs were unpriced', () => {
    const out = formatCosts(
      summariseCosts([
        entry('argus', usage(1)),
        entry('argus', usage(3)),
        entry('iris', usage(null)),
      ]),
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('argus');
    expect(lines[0]).toContain('$4.00 avg $2.00');
    expect(lines[1]).toContain('1 run unpriced');
  });
});
