import { describe, expect, it } from 'vitest';
import { followUpRefusals, type OpenIssue } from './follow-ups.ts';

const issue = (
  number: number,
  labels: string[],
  body: string,
  comments: string[] = [],
): OpenIssue => ({
  number,
  labels,
  body,
  comments,
});
const base = {
  pr: 170,
  closes: [69, 71, 144],
  mergedBatches: [130],
  openIssues: [] as OpenIssue[],
  comments: [] as string[],
};

describe('followUpRefusals (#154)', () => {
  it('refuses a batch while a follow-up of an earlier batch is still open', () => {
    const open = issue(148, ['build-task', 'follow-up'], '**Follow-up of:** #130');
    expect(followUpRefusals({ ...base, openIssues: [open] })).toEqual([
      '#148, a follow-up of batch #130, is still open: it lands before the next batch merges (§19), or Zeus records an exception on it',
    ]);
  });

  it("lets through the follow-ups this batch closes, and ones whose batch hasn't merged", () => {
    expect(
      followUpRefusals({
        ...base,
        openIssues: [
          issue(144, ['build-task', 'follow-up'], '**Follow-up of:** #130'),
          issue(160, ['build-task', 'follow-up'], '**Follow-up of:** #165'),
        ],
      }),
    ).toEqual([]);
  });

  it('reads every PR a follow-up names, and an exception Zeus recorded on it', () => {
    const many = issue(148, ['follow-up'], '**Follow-up of:** #146, #130, #152');
    expect(followUpRefusals({ ...base, openIssues: [many] })).toHaveLength(1);
    const excused = issue(148, ['follow-up'], '**Follow-up of:** #130', [
      '🦉 Athena: Zeus decided (2026-11-12, in chat): an exception for #148, it may stay open past the Data batch.',
    ]);
    expect(followUpRefusals({ ...base, openIssues: [excused] })).toEqual([]);
  });

  it("refuses a batch while a planned task's follow-up item of an earlier batch is unticked", () => {
    const planned = issue(
      72,
      ['build-task'],
      '**Done when**\n- [x] queues\n- [ ] a migration test (follow-up of #130)\n- [ ] other',
    );
    expect(followUpRefusals({ ...base, openIssues: [planned] })).toEqual([
      '#72\'s Done-when item "a migration test (follow-up of #130)" is a follow-up of batch #130 and still unticked',
    ]);
    const ticked = issue(72, ['build-task'], '- [x] a migration test (follow-up of #130)');
    expect(followUpRefusals({ ...base, openIssues: [ticked] })).toEqual([]);
  });

  it('checks each `Follow-up: #N` line on this batch names a follow-up of this batch', () => {
    const real = issue(171, ['build-task', 'follow-up'], '**Follow-up of:** #170');
    const wrong = issue(172, ['build-task'], '**Goal:** x');
    const elsewhere = issue(173, ['follow-up'], '**Follow-up of:** #130');
    expect(
      followUpRefusals({
        ...base,
        mergedBatches: [],
        openIssues: [real, wrong, elsewhere],
        comments: [
          "🦉 Athena: Argus F2's nit.\nFollow-up: #171\nFollow-ups: #172, #173, #999",
          'A note that mentions follow-up #172 in prose is not a link.',
        ],
      }),
    ).toEqual([
      '#172 is linked as a follow-up of this batch but has no `follow-up` label or no **Follow-up of:** #170 line',
      '#173 is linked as a follow-up of this batch but has no `follow-up` label or no **Follow-up of:** #170 line',
      '#999 is linked as a follow-up of this batch but is not an open issue',
    ]);
  });
});
