import { describe, expect, it } from 'vitest';
import {
  followUpRefusals,
  landingProblem,
  wantsComments,
  type ClosedFollowUp,
  type OpenIssue,
} from './follow-ups.ts';

const ZEUS = 'picasso-canvas';
const issue = (
  number: number,
  labels: string[],
  body: string,
  comments: { author: string; body: string }[] = [],
): OpenIssue => ({
  number,
  labels,
  body,
  comments,
});
const closed = (over: Partial<ClosedFollowUp> = {}): ClosedFollowUp => ({
  number: 148,
  labels: ['build-task', 'follow-up'],
  body: '**Follow-up of:** #130',
  stateReason: 'COMPLETED',
  mergedClosers: 1,
  comments: [],
  ...over,
});
const base = {
  pr: 170,
  closes: [69, 71, 144],
  mergedBatches: [130],
  openIssues: [] as OpenIssue[],
  closedIssues: [] as ClosedFollowUp[],
  closedCutOff: false,
  comments: [] as { author: string; body: string }[],
  zeusLogin: ZEUS,
  listCutOff: false,
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
      {
        author: ZEUS,
        body: '🦉 Athena: Zeus decided (2026-11-12, in chat): exception granted for #148. It may stay open past the Data batch.',
      },
    ]);
    expect(followUpRefusals({ ...base, openIssues: [excused] })).toEqual([]);
  });

  it("takes only Zeus's own record that grants an exception for this very follow-up (Argus F2, Cerberus F2 on #170; Cerberus F1, Argus F3 in round 2)", () => {
    const record = (author: string, body: string) =>
      issue(148, ['follow-up'], '**Follow-up of:** #130', [{ author, body }]);
    for (const wrong of [
      record(
        'someone-else',
        '🦉 Athena: Zeus decided (2026-11-12, in chat): exception granted for #148.',
      ),
      record(ZEUS, '🦉 Athena: Zeus decided (2026-11-12, in chat): no exception for #148.'),
      record(ZEUS, '🦉 Athena: Zeus decided (2026-11-12, in chat): no exception granted for #148.'),
      record(
        ZEUS,
        '🦉 Athena: Zeus decided (2026-11-12, in chat): exception granted for #148? No, it lands first.',
      ),
      record(
        ZEUS,
        '🦉 Athena: Zeus decided (2026-11-12, in chat): it lands first, so the exception granted for #148 earlier is withdrawn.',
      ),
      record(ZEUS, '🦉 Athena: Zeus decided (2026-11-12, in chat): exception granted for #149.'),
      record(
        ZEUS,
        "Daedalus's approach (builder's text, shipped by 🦉 Athena):\n🦉 Athena: Zeus decided (2026-11-12): exception granted for #148",
      ),
    ])
      expect(followUpRefusals({ ...base, openIssues: [wrong] })).toHaveLength(1);
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

  it("takes Zeus's exception on a planned task's follow-up item too (Argus F2 in round 2 on #170)", () => {
    const planned = issue(72, ['build-task'], '- [ ] a migration test (follow-up of #130)', [
      {
        author: ZEUS,
        body: '🦉 Athena: Zeus decided (2026-11-12, in chat): exception granted for #72.',
      },
    ]);
    expect(followUpRefusals({ ...base, openIssues: [planned] })).toEqual([]);
  });

  it('reads every batch a follow-up item names, and refuses one it cannot read (Cerberus F2, Argus F4 in round 2 on #170)', () => {
    const refusals = (line: string) =>
      followUpRefusals({
        ...base,
        mergedBatches: [130, 146],
        openIssues: [issue(72, ['build-task'], line)],
      });
    expect(refusals('- [ ] a test (follow-up of #130) (follow-up of #146)')).toHaveLength(2);
    expect(refusals('- [ ] a test (follow-up of #165, #130)')).toEqual([
      '#72\'s Done-when item "a test (follow-up of #165, #130)" is a follow-up of batch #130 and still unticked',
    ]);
    expect(refusals('- [ ] a test (follow-up of PR #146)')).toHaveLength(1);
    expect(refusals('- [ ] a test (follow-up of the Data batch)')).toEqual([
      '#72\'s Done-when item "a test (follow-up of the Data batch)" says it is a follow-up but names no batch PR (#N): Athena names it',
    ]);
  });

  it('wants the comments of a follow-up issue and of a task with an unticked follow-up item, for an exception', () => {
    expect(wantsComments(['follow-up'], 'x')).toBe(true);
    expect(wantsComments(['build-task'], '- [ ] a test (follow-up of #130)')).toBe(true);
    expect(wantsComments(['build-task'], '- [x] a test (follow-up of #130)')).toBe(false);
    expect(wantsComments(['build-task'], '**Goal:** x')).toBe(false);
  });

  it('finds a follow-up item however it is bulleted, indented or capitalised (Argus F4, Cerberus F3 on #170)', () => {
    for (const line of [
      '  - [ ] a test (follow-up of #130)',
      '* [ ] a test (follow-up of #130)',
      '+ [ ] a test (Follow-up of #130)',
    ])
      expect(
        followUpRefusals({ ...base, openIssues: [issue(72, ['build-task'], line)] }),
        line,
      ).toHaveLength(1);
  });

  it('refuses when the list of open issues may be cut off (Argus F5, Cerberus F4 on #170)', () => {
    expect(followUpRefusals({ ...base, listCutOff: true })).toEqual([
      'the list of open issues may be cut off, so a follow-up could go unseen: Athena checks why there are so many',
    ]);
  });

  it("checks each `Follow-up: #N` line from Zeus's account names a follow-up of this batch (Argus F1 in round 2 on #170)", () => {
    const real = issue(171, ['build-task', 'follow-up'], '**Follow-up of:** #170');
    const wrong = issue(172, ['build-task'], '**Goal:** x');
    const elsewhere = issue(173, ['follow-up'], '**Follow-up of:** #130');
    expect(
      followUpRefusals({
        ...base,
        mergedBatches: [],
        openIssues: [real, wrong, elsewhere],
        comments: [
          {
            author: ZEUS,
            body: "🦉 Athena: Argus F2's nit.\nFollow-up: #171\nFollow-ups: #172, #173, #999",
          },
          { author: ZEUS, body: 'A note that mentions follow-up #172 in prose is not a link.' },
          // Another account's line is no answer, so the gate doesn't vouch for it either way.
          { author: 'someone-else', body: 'Follow-up: #998' },
        ],
      }),
    ).toEqual([
      '#172 is linked as a follow-up of this batch but has no `follow-up` label or no **Follow-up of:** #170 line',
      '#173 is linked as a follow-up of this batch but has no `follow-up` label or no **Follow-up of:** #170 line',
      '#999 is linked as a follow-up of this batch but is not an open issue',
    ]);
  });
});

describe('a follow-up closed without landing (#275)', () => {
  const refusals = (...issues: ClosedFollowUp[]) =>
    followUpRefusals({ ...base, closedIssues: issues });

  it('lets through a follow-up that landed: completed, closed by a merged PR, label kept', () => {
    expect(landingProblem(closed())).toBeNull();
    expect(refusals(closed())).toEqual([]);
  });

  it('refuses one closed as not planned, with no merged PR closing it, or with its label removed', () => {
    expect(landingProblem(closed({ stateReason: 'NOT_PLANNED' }))).toMatch(/not planned/);
    expect(landingProblem(closed({ mergedClosers: 0 }))).toMatch(/no merged pull request/);
    expect(landingProblem(closed({ labels: ['build-task'] }))).toMatch(/label was removed/);
    for (const bad of [
      closed({ stateReason: 'NOT_PLANNED' }),
      closed({ mergedClosers: 0 }),
      closed({ labels: ['build-task'] }),
    ])
      expect(refusals(bad)).toEqual([
        expect.stringMatching(
          /^#148, a follow-up of batch #130, was closed without landing \(.+\): /,
        ),
      ]);
    expect(refusals(closed({ stateReason: 'NOT_PLANNED', mergedClosers: 0 }))[0]).toMatch(
      /not planned.*no merged pull request/,
    );
  });

  it("takes Zeus's recorded exception, and ignores a closed issue of no earlier batch", () => {
    const grant = {
      author: ZEUS,
      body: '🦉 Athena: Zeus decided (2026-11-19, in chat): exception granted for #148.',
    };
    expect(refusals(closed({ stateReason: 'NOT_PLANNED', comments: [grant] }))).toEqual([]);
    expect(
      refusals(closed({ stateReason: 'NOT_PLANNED', comments: [{ ...grant, author: 'someone' }] })),
    ).toHaveLength(1);
    // A follow-up of a task, of a batch not yet merged, or this batch's own: nothing to land before this batch.
    for (const body of [
      '**Follow-up of:** #79',
      '**Follow-up of:** #165',
      '**Follow-up of:** #170',
    ])
      expect(refusals(closed({ stateReason: 'NOT_PLANNED', body }))).toEqual([]);
  });

  it('refuses when the list of closed issues may be cut off', () => {
    expect(followUpRefusals({ ...base, closedCutOff: true })).toEqual([
      'the list of closed issues may be cut off, so a follow-up closed without landing could go unseen: Athena checks why there are so many',
    ]);
  });
});

describe('a follow-up item is only one that carries the marker itself (#275)', () => {
  const held = (line: string) =>
    followUpRefusals({ ...base, openIssues: [issue(72, ['build-task'], line)] });

  it('does not hold a batch for an item that talks about follow-ups in prose or quotes the marker in backticks', () => {
    for (const line of [
      '- [ ] explain what a follow-up of #130 means in the review text',
      '- [ ] the gate reads a `(follow-up of #130)` marker only in parentheses',
      '- [ ] an example, written (`(follow-up of #130)`), is not a marker',
      "- [ ] the gate's marker check reads follow-up of batch #130 items",
    ]) {
      expect(held(line), line).toEqual([]);
      expect(wantsComments(['build-task'], line), line).toBe(false);
    }
  });

  it('still holds a batch for the marker itself, in parentheses with a #N, even beside a quoted one', () => {
    for (const line of [
      '- [ ] a migration test (follow-up of #130)',
      '- [ ] a test (follow-up of #165, #130) and a note about `(follow-up of #5)`',
    ])
      expect(held(line), line).toHaveLength(1);
    expect(wantsComments(['build-task'], '- [ ] a test (follow-up of #130)')).toBe(true);
  });
});

describe('a Follow-up link stays on its line (#275)', () => {
  const linkedTo = (body: string) => {
    const open = [171, 172, 173, 5, 6].map((n) =>
      issue(n, ['follow-up'], '**Follow-up of:** #170'),
    );
    return followUpRefusals({
      ...base,
      mergedBatches: [],
      openIssues: open,
      comments: [{ author: ZEUS, body }],
    });
  };

  it("doesn't read a #N at the start of the next line as part of the list", () => {
    // #5 and #6 are real follow-ups of this batch, so a link to either is accepted; an unrelated #N would be refused.
    const refused = (body: string) =>
      followUpRefusals({
        ...base,
        mergedBatches: [],
        openIssues: [issue(5, ['follow-up'], '**Follow-up of:** #170')],
        comments: [{ author: ZEUS, body }],
      });
    expect(refused('Follow-up: #5,\n#999 is a different thing')).toEqual([]);
    expect(refused('Follow-ups: #5\n#999 starts a list item')).toEqual([]);
    expect(refused('Follow-up: #5, #999')).toEqual([
      '#999 is linked as a follow-up of this batch but is not an open issue',
    ]);
    expect(linkedTo('Follow-ups: #171, #172 and #173')).toEqual([]);
  });
});

describe('an exception counts only when the grant ends the decision (#275)', () => {
  const grant = (tail: string) =>
    followUpRefusals({
      ...base,
      openIssues: [
        issue(148, ['follow-up'], '**Follow-up of:** #130', [
          {
            author: ZEUS,
            body: `🦉 Athena: Zeus decided (2026-11-19, in chat): exception granted for #148${tail}`,
          },
        ]),
      ],
    });

  it('grants only at a full stop or the end of the line', () => {
    for (const tail of ['', '.', '. It may stay open.', '  ', '\nDetails follow.', '.\nMore.'])
      expect(grant(tail), JSON.stringify(tail)).toEqual([]);
  });

  it('grants nothing when a colon, dash or semicolon follows #N', () => {
    for (const tail of [
      ': no, withdrawn',
      ' — withdrawn',
      ' – withdrawn',
      ' - withdrawn',
      '; no',
      ', but only if it lands',
    ])
      expect(grant(tail), JSON.stringify(tail)).toHaveLength(1);
  });
});
