import { describe, expect, it } from 'vitest';
import { bodyHash, doneWhenBoxes, evaluate } from './evaluate.ts';
import type { Facts, ReviewRecord } from './types.ts';

const SHA = 'a'.repeat(40);
const BODY = 'Closes #42\n\n**Done when**\n- [x] it works\n- [x] tests pass\n\nAgent: Daedalus';

function review(
  reviewer: ReviewRecord['reviewer'],
  over: Partial<ReviewRecord> = {},
): ReviewRecord {
  return {
    pr: 7,
    sha: SHA,
    reviewer,
    verdict: 'pass',
    bodyHash: bodyHash(BODY),
    summary: 'ok',
    at: '2026-11-07T00:00:00Z',
    ...(reviewer === 'redteam'
      ? {}
      : { meta: { agent: `${reviewer}-agent`, sessionId: 's-1', verified: true } }),
    ...over,
  };
}

function facts(over: Partial<Facts> = {}): Facts {
  return {
    pr: 7,
    paused: 'false',
    state: 'OPEN',
    isDraft: false,
    baseRef: 'main',
    headRef: '42-something',
    headSha: SHA,
    title: '[H0] Something',
    mergeable: 'MERGEABLE',
    behindBy: 0,
    body: BODY,
    closingIssues: [{ number: 42, inRepo: true, labels: ['build-task'], doneWhenBoxes: 2 }],
    changedFiles: ['packages/ui/src/button.ts'],
    labels: ['routine'],
    checkRuns: [
      { name: 'ci', status: 'completed', conclusion: 'success', app: 'github-actions' },
      { name: 'risk-gate', status: 'completed', conclusion: 'success', app: 'github-actions' },
    ],
    statuses: [],
    reviews: [review('argus')],
    sensitivePatterns: ['packages/auth/**', 'scripts/**', '.github/**', '**/CLAUDE.md'],
    cerberusPatterns: ['packages/auth/**', 'packages/db/**'],
    config: {
      requiredChecks: ['ci', 'risk-gate'],
      requireTierLabel: true,
      requireIris: false,
      uiPaths: ['apps/web/**', 'packages/ui/**'],
      harnessPaths: ['.github/**', '.claude/**', 'scripts/**', 'CLAUDE.md', '**/CLAUDE.md'],
    },
    ...over,
  };
}

function failedIds(f: Facts): number[] {
  return evaluate(f)
    .items.filter((item) => !item.ok)
    .map((item) => item.id);
}

describe('evaluate', () => {
  it('passes a routine PR with every item met', () => {
    const result = evaluate(facts());
    expect(result.ok).toBe(true);
    expect(result.tier).toBe('routine');
    expect(result.items).toHaveLength(7);
  });

  it('refuses when frozen or when the freeze switch cannot be read', () => {
    expect(failedIds(facts({ paused: 'true' }))).toEqual([1]);
    expect(failedIds(facts({ paused: 'TRUE ' }))).toEqual([1]);
    expect(failedIds(facts({ paused: null }))).toEqual([1]);
    expect(failedIds(facts({ paused: '' }))).toEqual([1]);
  });

  it('refuses drafts, conflicts, stale branches, other bases and unlinked code PRs', () => {
    expect(failedIds(facts({ isDraft: true }))).toEqual([2]);
    expect(failedIds(facts({ state: 'CLOSED' }))).toEqual([2]);
    expect(failedIds(facts({ mergeable: 'CONFLICTING' }))).toEqual([2]);
    expect(failedIds(facts({ mergeable: 'UNKNOWN' }))).toEqual([2]);
    expect(failedIds(facts({ behindBy: 1 }))).toEqual([2]);
    expect(failedIds(facts({ behindBy: null }))).toEqual([2]);
    expect(failedIds(facts({ baseRef: 'dev' }))).toEqual([2]);
    expect(failedIds(facts({ closingIssues: [] }))).toEqual([2]);
    expect(
      failedIds(
        facts({
          closingIssues: [
            { number: 3, inRepo: true, labels: ['partner-feedback'], doneWhenBoxes: 0 },
          ],
        }),
      ),
    ).toEqual([2]);
  });

  it('accepts a PR closing a section issue, or changing only plain Markdown', () => {
    expect(
      failedIds(
        facts({
          closingIssues: [{ number: 5, inRepo: true, labels: ['section'], doneWhenBoxes: 0 }],
        }),
      ),
    ).toEqual([]);
    const f = facts({ closingIssues: [], changedFiles: ['README.md', 'docs/notes.md'] });
    expect(failedIds(f)).toEqual([]);
  });

  it('does not count harness Markdown (agents, skills, CLAUDE.md) as plain Markdown', () => {
    const agent = facts({
      closingIssues: [],
      changedFiles: ['.claude/agents/daedalus-builder.md'],
    });
    expect(failedIds(agent)).toContain(2);
    const claude = facts({ closingIssues: [], changedFiles: ['packages/db/CLAUDE.md'] });
    expect(failedIds(claude)).toContain(2);
  });

  it('refuses red, pending, skipped or missing required checks, and failing statuses', () => {
    const run = (conclusion: string | null, status = 'completed') => ({
      name: 'ci',
      status,
      conclusion,
      app: 'github-actions',
    });
    const rg = {
      name: 'risk-gate',
      status: 'completed',
      conclusion: 'success',
      app: 'github-actions',
    };
    expect(failedIds(facts({ checkRuns: [run('failure'), rg] }))).toEqual([3]);
    expect(failedIds(facts({ checkRuns: [run(null, 'in_progress'), rg] }))).toEqual([3]);
    expect(failedIds(facts({ checkRuns: [run('skipped'), rg] }))).toEqual([3]);
    expect(failedIds(facts({ checkRuns: [run('neutral'), rg] }))).toEqual([3]);
    expect(failedIds(facts({ checkRuns: [rg] }))).toEqual([3]);
    expect(failedIds(facts({ statuses: [{ context: 'x', state: 'pending' }] }))).toEqual([3]);
    const extra = { name: 'other', status: 'completed', conclusion: 'failure', app: 'x' };
    expect(failedIds(facts({ checkRuns: [run('success'), rg, extra] }))).toEqual([3]);
  });

  it('refuses when no required check is configured', () => {
    const f = facts();
    expect(failedIds({ ...f, config: { ...f.config, requiredChecks: [] } })).toEqual([3]);
  });

  it('works the tier out from the paths and refuses a label that disagrees', () => {
    const auth = { changedFiles: ['packages/auth/src/session.ts'] };
    expect(failedIds(facts({ ...auth, labels: ['routine'] }))).toContain(4);
    expect(failedIds(facts({ labels: ['sensitive'] }))).toEqual([4]);
    expect(failedIds(facts({ labels: [] }))).toEqual([4]);
    expect(failedIds(facts({ labels: ['routine', 'sensitive'] }))).toEqual([4]);
  });

  it('treats every PR as sensitive while main has no sensitive-paths list', () => {
    const f = facts({ sensitivePatterns: null, labels: ['sensitive'] });
    expect(evaluate(f).tier).toBe('sensitive');
    expect(failedIds(f)).toEqual([5]); // Cerberus now required
    expect(failedIds({ ...f, reviews: [review('argus'), review('cerberus')] })).toEqual([]);
  });

  it('counts renamed-away paths: moving a file out of a sensitive folder is sensitive', () => {
    const f = facts({ changedFiles: ['packages/auth/old.ts', 'packages/ui/old.ts'] });
    expect(evaluate(f).tier).toBe('sensitive');
  });

  it('needs Argus, plus Cerberus on sensitive PRs, for this head commit and this PR text', () => {
    const sens = {
      changedFiles: ['packages/auth/src/x.ts'],
      labels: ['sensitive'],
    };
    expect(failedIds(facts({ reviews: [] }))).toEqual([5]);
    expect(failedIds(facts({ ...sens }))).toEqual([5]);
    expect(failedIds(facts({ ...sens, reviews: [review('argus'), review('cerberus')] }))).toEqual(
      [],
    );
    // a later push makes the reviews stale
    expect(failedIds(facts({ reviews: [review('argus', { sha: 'b'.repeat(40) })] }))).toEqual([5]);
    // an edited PR text makes the reviews stale
    expect(failedIds(facts({ reviews: [review('argus', { bodyHash: 'x' })] }))).toEqual([5]);
    // any blocking verdict on this commit refuses, even next to a pass
    const blocked = [review('argus'), review('cerberus', { verdict: 'block' })];
    expect(failedIds(facts({ reviews: blocked }))).toEqual([5]);
  });

  it('needs Iris for UI paths once enabled', () => {
    const f = facts();
    const withIris = { ...f, config: { ...f.config, requireIris: true } };
    expect(failedIds(withIris)).toEqual([5]);
    expect(failedIds({ ...withIris, reviews: [review('argus'), review('iris')] })).toEqual([]);
    expect(failedIds({ ...withIris, changedFiles: ['packages/core/src/a.ts'] })).toEqual([]);
  });

  it('refuses an unticked or missing Done-when list', () => {
    const unticked = BODY.replace('- [x] tests pass', '- [ ] tests pass');
    const noList = 'Closes #42\n\nAgent: Daedalus';
    const ok = (body: string) => [review('argus', { bodyHash: bodyHash(body) })];
    expect(failedIds(facts({ body: unticked, reviews: ok(unticked) }))).toEqual([6]);
    expect(failedIds(facts({ body: noList, reviews: ok(noList) }))).toEqual([6]);
  });

  it('needs a red-team record when a harness path changes', () => {
    const harness = {
      changedFiles: ['scripts/merge-gate.ts'],
      labels: ['sensitive'],
      reviews: [review('argus'), review('cerberus')],
    };
    expect(failedIds(facts(harness))).toEqual([7]);
    const withRedTeam = { ...harness, reviews: [...harness.reviews, review('redteam')] };
    expect(failedIds(facts(withRedTeam))).toEqual([]);
    expect(failedIds(facts({ ...harness, changedFiles: ['packages/db/CLAUDE.md'] }))).toEqual([7]);
  });

  it('sees dot folders: a hidden folder inside a sensitive or harness path still counts', () => {
    const auth = facts({ changedFiles: ['packages/auth/.internal/session.ts'], labels: [] });
    expect(evaluate(auth).tier).toBe('sensitive');
    const evil = facts({ changedFiles: ['.github/workflows/.evil.yml'], labels: [] });
    expect(failedIds(evil)).toContain(7);
    const md = facts({ closingIssues: [], changedFiles: ['apps/web/.x/CLAUDE.md'] });
    expect(failedIds(md)).toContain(2);
  });

  it('needs required checks from GitHub Actions, not another app with the same name', () => {
    const fake = { name: 'ci', status: 'completed', conclusion: 'success', app: 'some-app' };
    const rg = {
      name: 'risk-gate',
      status: 'completed',
      conclusion: 'success',
      app: 'github-actions',
    };
    expect(failedIds(facts({ checkRuns: [fake, rg] }))).toEqual([3]);
  });

  it('refuses a title that would skip CI on main, and an issue in another repo', () => {
    expect(failedIds(facts({ title: 'fix [skip ci]' }))).toEqual([2]);
    const other = { number: 42, inRepo: false, labels: [], doneWhenBoxes: 0 };
    expect(failedIds(facts({ closingIssues: [other] }))).toEqual([2]);
  });

  it('needs at least as many ticked boxes as the issue lists', () => {
    const issue = { number: 42, inRepo: true, labels: ['build-task'], doneWhenBoxes: 3 };
    expect(failedIds(facts({ closingIssues: [issue] }))).toEqual([6]);
  });

  it('keeps refusing a commit once any reviewer blocked it, even after a later pass', () => {
    const reviews = [review('argus', { verdict: 'block' }), review('argus')];
    expect(failedIds(facts({ reviews }))).toEqual([5]);
  });

  it('refuses an empty change list', () => {
    expect(failedIds(facts({ changedFiles: [] }))).toEqual([2]);
  });
});

describe('doneWhenBoxes', () => {
  it('is not fooled by fences, comments, indented bold or other list markers', () => {
    const body = [
      '**Done when**',
      '- [x] one',
      '  **Evidence:** output below',
      '```',
      '# not a heading',
      '- [x] fake box in a fence',
      '```',
      '<!-- - [x] fake box in a comment -->',
      '+ [ ] plus marker',
      '1. [ ] numbered',
      '> - [ ] quoted',
      '- [X] two',
    ].join('\n');
    expect(doneWhenBoxes(body)).toEqual({ ticked: 2, unticked: 3 });
  });

  it('reads boxes under a bold or heading "Done when" until the next heading', () => {
    const body = '## Done when\n- [x] a\n* [X] b\n- [ ] c\n\n## Notes\n- [ ] not counted';
    expect(doneWhenBoxes(body)).toEqual({ ticked: 2, unticked: 1 });
    expect(doneWhenBoxes('**Done when**\n- [x] a\n**Predicted tier:** x\n- [ ] no')).toEqual({
      ticked: 1,
      unticked: 0,
    });
    expect(doneWhenBoxes('nothing here')).toEqual({ ticked: 0, unticked: 0 });
  });
});

describe('bodyHash', () => {
  it('ignores line-ending differences only', () => {
    expect(bodyHash('a\r\nb')).toBe(bodyHash('a\nb'));
    expect(bodyHash('a\nb')).not.toBe(bodyHash('a\nc'));
  });
});

describe('evaluate: reviews must come from the runner', () => {
  it('ignores an argus or cerberus pass without a Claude Code session (hand-written)', () => {
    const handWritten = review('argus', { meta: undefined });
    expect(evaluate({ ...facts(), reviews: [handWritten] }).items.find((i) => i.id === 5)?.ok).toBe(
      false,
    );
    const noSession = review('argus', { meta: { agent: 'argus-reviewer', sessionId: null } });
    expect(evaluate({ ...facts(), reviews: [noSession] }).items.find((i) => i.id === 5)?.ok).toBe(
      false,
    );
  });

  it('still counts a hand-written block (blocks always count)', () => {
    const blocks = [
      review('argus'),
      review('cerberus'),
      review('cerberus', { verdict: 'block', meta: undefined }),
    ];
    expect(
      evaluate({
        ...facts(),
        labels: ['sensitive'],
        changedFiles: ['packages/auth/x.ts'],
        reviews: blocks,
      }).items.find((i) => i.id === 5)?.ok,
    ).toBe(false);
  });
});

describe('evaluate: only verified sessions count', () => {
  it('ignores a pass whose transcript did not check out', () => {
    const unverified = review('argus', {
      meta: { agent: 'argus-reviewer', sessionId: 's-x', verified: false },
    });
    expect(evaluate(facts({ reviews: [unverified] })).items.find((i) => i.id === 5)?.ok).toBe(
      false,
    );
  });
});

describe('evaluate: a builder PR into staging (Zeus, 2026-11-07)', () => {
  const toStaging = (over: Partial<Facts> = {}) =>
    facts({ baseRef: 'staging', reviews: [], ...over });

  it('merges on the automatic checks alone: no Argus', () => {
    expect(failedIds(toStaging())).toEqual([]);
  });

  it('still needs Cerberus when the PR touches a risky area', () => {
    const risky = toStaging({
      changedFiles: ['packages/db/src/schema.ts'],
      sensitivePatterns: ['packages/db/**'],
      labels: ['sensitive'],
    });
    expect(failedIds(risky)).toEqual([5]);
    expect(failedIds({ ...risky, reviews: [review('cerberus')] })).toEqual([]);
    // Without the risky-area list on main, every staging PR needs Cerberus (fail safe).
    expect(failedIds(toStaging({ cerberusPatterns: null }))).toEqual([5]);
  });

  it('refuses harness paths (they go straight to main) and a branch behind staging', () => {
    const harness = toStaging({
      changedFiles: ['scripts/x.ts'],
      labels: ['sensitive'],
      reviews: [review('cerberus')],
    });
    expect(failedIds(harness)).toContain(7);
    expect(evaluate(toStaging({ behindBy: 2 })).items.find((i) => i.id === 2)?.detail).toMatch(
      /behind staging/,
    );
  });
});

describe('evaluate: the batch PR from staging into main', () => {
  const batchBody =
    'Closes #42\nCloses #43\n\n**Done when**\n- [x] #42 (PR #50): merged into staging through the gate\n- [x] #43 (PR #51): merged into staging through the gate';
  const batch = (over: Partial<Facts> = {}) =>
    facts({
      headRef: 'staging',
      body: batchBody,
      closingIssues: [
        { number: 42, inRepo: true, labels: ['build-task'], doneWhenBoxes: 6 },
        { number: 43, inRepo: true, labels: ['build-task'], doneWhenBoxes: 4 },
      ],
      reviews: [review('argus', { bodyHash: bodyHash(batchBody) })],
      ...over,
    });

  it('gets the full review, with one ticked box per task', () => {
    expect(failedIds(batch())).toEqual([]);
    expect(failedIds(batch({ reviews: [] }))).toEqual([5]);
  });

  it('refuses a batch that carries a harness path, or misses a task box', () => {
    expect(
      failedIds(
        batch({
          changedFiles: ['packages/ui/src/button.ts', 'scripts/x.ts'],
          labels: ['sensitive'],
          reviews: [
            review('argus', { bodyHash: bodyHash(batchBody) }),
            review('cerberus', { bodyHash: bodyHash(batchBody) }),
            review('redteam', { bodyHash: bodyHash(batchBody) }),
          ],
        }),
      ),
    ).toEqual([7]);
    const oneBox = 'Closes #42\nCloses #43\n\n**Done when**\n- [x] #42 (PR #50): merged';
    expect(
      failedIds(
        batch({ body: oneBox, reviews: [review('argus', { bodyHash: bodyHash(oneBox) })] }),
      ),
    ).toEqual([6]);
  });
});

describe('evaluate: targets', () => {
  it('refuses any base but main and staging', () => {
    expect(failedIds(facts({ baseRef: 'release' }))).toContain(2);
  });
});
