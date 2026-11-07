import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logMerge, readReviews, writeReview } from './reviews.ts';
import type { ReviewRecord } from './types.ts';

const SHA = 'c'.repeat(40);
const record: ReviewRecord = {
  pr: 9,
  sha: SHA,
  reviewer: 'argus',
  verdict: 'pass',
  bodyHash: 'h',
  summary: 'fine',
  at: '2026-11-07T00:00:00Z',
};

describe('review records', () => {
  it('round-trips a record, private to the user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-reviews-'));
    const file = writeReview(record, dir);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readReviews(9, SHA, dir)).toEqual([record]);
    expect(readReviews(9, 'd'.repeat(40), dir)).toEqual([]);
  });

  it('is append-only: a later pass sits next to an earlier block, never over it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-reviews-'));
    writeReview({ ...record, verdict: 'block' }, dir);
    writeReview(record, dir);
    const verdicts = readReviews(9, SHA, dir)
      .map((r) => r.verdict)
      .sort();
    expect(verdicts).toEqual(['block', 'pass']);
  });

  it('counts a stray file in the review folder as a block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-reviews-'));
    const file = writeReview(record, dir);
    writeFileSync(join(dirname(file), 'argus.json'), JSON.stringify(record));
    expect(
      readReviews(9, SHA, dir)
        .map((r) => r.verdict)
        .sort(),
    ).toEqual(['block', 'pass']);
  });

  it('turns an unreadable or mismatched record into a block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-reviews-'));
    const file = writeReview(record, dir);
    writeFileSync(file, '{not json');
    expect(readReviews(9, SHA, dir)[0]?.verdict).toBe('block');
    writeFileSync(file, JSON.stringify({ ...record, sha: 'e'.repeat(40) }));
    expect(readReviews(9, SHA, dir)[0]?.verdict).toBe('block');
  });

  it('refuses bad PR numbers and SHAs (no path tricks)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-reviews-'));
    expect(() => readReviews(0, SHA, dir)).toThrow();
    expect(() => readReviews(9, '../../etc', dir)).toThrow();
    expect(() => writeReview({ ...record, sha: 'abc' }, dir)).toThrow();
  });

  it('appends merge log lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-log-'));
    logMerge({ pr: 1, result: 'merged' }, dir);
    logMerge({ pr: 2, result: 'refused' }, dir);
    const lines = readFileSync(join(dir, 'merges.jsonl'), 'utf8').trim().split('\n');
    expect(lines.map((l) => (JSON.parse(l) as { pr: number }).pr)).toEqual([1, 2]);
  });
});
