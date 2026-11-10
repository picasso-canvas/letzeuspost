import { describe, expect, it } from 'vitest';
import { collectFacts, parseConfig, type CollectDeps } from './collect.ts';
import { bodyHash } from './evaluate.ts';
import { reviewPrompt } from './meta.ts';

const SHA = 'f'.repeat(40);
const CONFIG = JSON.stringify({
  requiredChecks: ['ci'],
  requireTierLabel: false,
  requireIris: false,
  uiPaths: ['packages/ui/**'],
  harnessPaths: ['scripts/**'],
});

function fakeGh(overrides: Record<string, string | Error> = {}): CollectDeps['gh'] {
  const answers: Record<string, string | Error> = {
    'variable get': 'false\n',
    'pr view': JSON.stringify({
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefOid: SHA,
      title: '[H0] Thing',
      mergeable: 'MERGEABLE',
      body: 'text',
      labels: [{ name: 'routine' }],
      closingIssuesReferences: [
        { number: 42, url: 'https://github.com/picasso-canvas/letzeuspost/issues/42' },
        { number: 9, url: 'https://github.com/someone/else/issues/9' },
      ],
    }),
    compare: '0\n',
    'issue view': JSON.stringify({
      labels: [{ name: 'build-task' }],
      body: '**Done when**\n- [ ] a\n- [ ] b\n\n**Areas:** `packages/ui/**`',
    }),
    'check-runs':
      '{"name":"ci","status":"completed","conclusion":"success","app":"github-actions"}\n',
    status: '',
    ...overrides,
  };
  return (args) => {
    const joined = args.join(' ');
    // The longest matching key wins, so a test can answer one `pr view` call apart from the others.
    const key = Object.keys(answers)
      .filter((k) => joined.includes(k))
      .sort((x, y) => y.length - x.length)[0];
    if (key === undefined) throw new Error(`unexpected gh call: ${joined}`);
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return answer ?? '';
  };
}

function fakeGit(head = SHA): CollectDeps['git'] {
  return (args) => {
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse') return `${head}\n`;
    if (args[0] === 'diff')
      return 'packages/ui/a.ts\0packages/auth/old.ts\0packages/ui/a.ts\0odd\nname.ts\0';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

function deps(over: Partial<CollectDeps> = {}): CollectDeps {
  return {
    gh: fakeGh(),
    git: fakeGit(),
    readMainFile: (path) =>
      path === '.github/merge-gate.json'
        ? CONFIG
        : path === '.github/sensitive-paths.txt'
          ? 'packages/auth/**'
          : null,
    readReviews: () => [],
    ...over,
  };
}

describe('collectFacts', () => {
  it('gathers the PR, files (renames under both names), checks and main-side files', () => {
    const f = collectFacts(7, deps());
    expect(f.headSha).toBe(SHA);
    expect(f.paused).toBe('false');
    expect(f.changedFiles).toEqual(['packages/ui/a.ts', 'packages/auth/old.ts', 'odd\nname.ts']);
    expect(f.closingIssues).toEqual([
      {
        number: 42,
        inRepo: true,
        labels: ['build-task'],
        doneWhenBoxes: 2,
        areas: ['packages/ui/**'],
      },
      { number: 9, inRepo: false, labels: [], doneWhenBoxes: 0, areas: null },
    ]);
    expect(f.checkRuns).toEqual([
      { name: 'ci', status: 'completed', conclusion: 'success', app: 'github-actions' },
    ]);
    expect(f.title).toBe('[H0] Thing');
    expect(f.statuses).toEqual([]);
    expect(f.behindBy).toBe(0);
    expect(f.sensitivePatterns).toEqual(['packages/auth/**']);
  });

  it('records an unreadable freeze switch or comparison as unknown (the gate then refuses)', () => {
    const gh = fakeGh({ 'variable get': new Error('403'), compare: new Error('500') });
    const f = collectFacts(7, deps({ gh }));
    expect(f.paused).toBeNull();
    expect(f.behindBy).toBeNull();
  });

  it('refuses when the PR head moved between the view and the fetch', () => {
    expect(() => collectFacts(7, deps({ git: fakeGit('b'.repeat(40)) }))).toThrow(/moved/);
  });

  it('reads reviews for the head commit only', () => {
    const seen: string[] = [];
    collectFacts(
      7,
      deps({
        readReviews: (pr, sha) => {
          seen.push(`${String(pr)}@${sha}`);
          return [];
        },
      }),
    );
    expect(seen).toEqual([`7@${SHA}`]);
  });

  it('refuses to run without the config on main, and with a malformed one', () => {
    expect(() => collectFacts(7, deps({ readMainFile: () => null }))).toThrow(/missing on main/);
    expect(() => parseConfig('{"requiredChecks":"ci"}')).toThrow(/requiredChecks/);
  });
});

describe('collectFacts re-checks every pass against its transcript', () => {
  it('marks a pass verified only when its session checks out', () => {
    const bundle = `/s/bundles/pr-7/${SHA.slice(0, 7)}-1`;
    const good = {
      pr: 7,
      sha: SHA,
      reviewer: 'argus' as const,
      verdict: 'pass' as const,
      bodyHash: bodyHash('text'),
      summary: 'VERDICT: pass',
      at: '',
      meta: { agent: 'argus-reviewer', sessionId: 's-ok', bundle },
    };
    const forged = {
      ...good,
      meta: { agent: 'argus-reviewer', sessionId: 's-fake', bundle, verified: true },
    }; // a stored flag never counts
    const f = collectFacts(
      7,
      deps({
        readReviews: () => [good, forged],
        readTranscript: (id) =>
          id === 's-ok'
            ? [
                JSON.stringify({ type: 'agent-setting', agentSetting: 'argus-reviewer' }),
                JSON.stringify({
                  type: 'user',
                  message: { content: reviewPrompt('argus', bundle) },
                }),
                JSON.stringify({
                  type: 'assistant',
                  message: { content: [{ type: 'text', text: 'VERDICT: pass' }] },
                }),
              ].join('\n')
            : null,
        stateDir: '/s',
        readFile: (path) =>
          path === `${bundle}/snapshot.json`
            ? JSON.stringify({ headRefOid: SHA, body: 'text' })
            : null,
      }),
    );
    expect(f.reviews.map((r) => r.meta?.verified)).toEqual([true, false]);
  });
});

describe('collectFacts: records that copy a real pass', () => {
  it('refuses a record whose PR text differs from the reviewed snapshot, and a null meta', () => {
    const bundle = `/s/bundles/pr-7/${SHA.slice(0, 7)}-1`;
    const real = [
      JSON.stringify({ type: 'agent-setting', agentSetting: 'argus-reviewer' }),
      JSON.stringify({ type: 'user', message: { content: reviewPrompt('argus', bundle) } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'VERDICT: pass' }] },
      }),
    ].join('\n');
    const copied = {
      pr: 7,
      sha: SHA,
      reviewer: 'argus' as const,
      verdict: 'pass' as const,
      bodyHash: bodyHash('edited text'),
      summary: 'VERDICT: pass',
      at: '',
      meta: { agent: 'argus-reviewer', sessionId: 's-ok', bundle },
    };
    const nullMeta = { ...copied, meta: null as unknown as undefined };
    const f = collectFacts(
      7,
      deps({
        readReviews: () => [copied, nullMeta],
        readTranscript: () => real,
        stateDir: '/s',
        readFile: () => JSON.stringify({ headRefOid: SHA, body: 'text' }),
      }),
    );
    expect(f.reviews.map((r) => r.meta?.verified ?? false)).toEqual([false, false]);
  });
});

describe('collectFacts takes the verdict from the verified summary', () => {
  it('counts a record that says pass but whose real answer was a block as a block', () => {
    const bundle = `/s/bundles/pr-7/${SHA.slice(0, 7)}-1`;
    const real = [
      JSON.stringify({ type: 'agent-setting', agentSetting: 'argus-reviewer' }),
      JSON.stringify({ type: 'user', message: { content: reviewPrompt('argus', bundle) } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'VERDICT: block\n[blocking] x — y — z' }] },
      }),
    ].join('\n');
    const relabelled = {
      pr: 7,
      sha: SHA,
      reviewer: 'argus' as const,
      verdict: 'pass' as const,
      bodyHash: bodyHash('text'),
      summary: 'VERDICT: block\n[blocking] x — y — z',
      at: '',
      meta: { agent: 'argus-reviewer', sessionId: 's-ok', bundle },
    };
    const f = collectFacts(
      7,
      deps({
        readReviews: () => [relabelled],
        readTranscript: () => real,
        stateDir: '/s',
        readFile: () => JSON.stringify({ headRefOid: SHA, body: 'text' }),
      }),
    );
    expect(f.reviews[0]?.verdict).toBe('block');
  });
});

describe("collectFacts: what Athena's hand-over is checked against (#138)", () => {
  it('lets the evidence name a commit with the same change, and takes the findings of the latest earlier round', () => {
    const OLD = '1'.repeat(40);
    const OLDER = '2'.repeat(40);
    const CARRIED = '3'.repeat(40);
    const git: CollectDeps['git'] = (args) => {
      if (args[0] === 'merge-base') return `${'b'.repeat(40)}\n`;
      // changeId: the raw diff from the merge-base; the head and CARRIED have the same change, OLD and OLDER don't.
      if (args[0] === 'diff' && args.includes('--raw'))
        return args.at(-1) === OLD || args.at(-1) === OLDER ? `old${args.at(-1) ?? ''}` : 'same';
      return fakeGit()(args);
    };
    const record = (sha: string, reviewer: 'argus' | 'cerberus', summary: string, at: string) => ({
      pr: 7,
      sha,
      reviewer,
      verdict: 'block' as const,
      bodyHash: 'h',
      summary,
      at,
    });
    const f = collectFacts(
      7,
      deps({
        git,
        listReviewedShas: () => [OLDER, OLD, CARRIED],
        readReviews: (_pr, sha) =>
          sha === OLD
            ? [
                record(
                  OLD,
                  'argus',
                  'VERDICT: block\n[blocking] F1 evidence pr.md — x',
                  '2026-11-10T02:00:00Z',
                ),
                record(
                  OLD,
                  'cerberus',
                  'VERDICT: pass\n[nit] F2 security a.ts — y',
                  '2026-11-10T02:00:01Z',
                ),
              ]
            : sha === OLDER
              ? [
                  record(
                    OLDER,
                    'argus',
                    'VERDICT: block\n[blocking] F7 plan a — z',
                    '2026-11-10T01:00:00Z',
                  ),
                ]
              : [],
      }),
    );
    expect(f.evidenceShas).toEqual([SHA, CARRIED]);
    expect(f.earlierFindingIds).toEqual(['Argus F1', 'Cerberus F2']);
  });
});

describe("collectFacts: a feature's journey, from CI's report (#156)", () => {
  const RUN_URL = 'https://github.com/picasso-canvas/letzeuspost/actions/runs/4242/job/99';
  const batchGh = (over: Record<string, string> = {}) =>
    fakeGh({
      'pr view': JSON.stringify({
        state: 'OPEN',
        isDraft: false,
        baseRefName: 'main',
        headRefName: 'staging',
        isCrossRepository: false,
        headRefOid: SHA,
        title: 'Batch',
        mergeable: 'MERGEABLE',
        body: 'Closes #72',
        labels: [{ name: 'sensitive' }],
        closingIssuesReferences: [
          { number: 72, url: 'https://github.com/picasso-canvas/letzeuspost/issues/72' },
          { number: 148, url: 'https://github.com/picasso-canvas/letzeuspost/issues/148' },
        ],
      }),
      'issue view 72 ': JSON.stringify({
        labels: [{ name: 'build-task' }, { name: 'feature:data' }],
        body: '**Done when**\n- [ ] a',
      }),
      'issue view 148 ': JSON.stringify({
        labels: [{ name: 'build-task' }, { name: 'follow-up' }],
        body: '**Done when**\n- [ ] a',
      }),
      // The open-issue list and the PR's comments are #154's; the feature's own list is the one asked here.
      'issue list': '[]',
      'issue list -R picasso-canvas/letzeuspost --label feature:data': JSON.stringify([
        { number: 72 },
      ]),
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'check-runs': `${JSON.stringify({ name: 'services', status: 'completed', conclusion: 'success', app: 'github-actions', url: RUN_URL })}\n`,
      ...over,
    });
  const batchDeps = (gh: CollectDeps['gh'], over: Partial<CollectDeps> = {}) =>
    deps({
      gh,
      git: (args) => (args[0] === 'log' ? '' : fakeGit()(args)),
      ...over,
    });
  const report = { 'vitest.json': JSON.stringify([]) };

  it("reads the journey report of the services run on the batch's head when the batch completes a feature", () => {
    const calls: string[] = [];
    const runs: number[] = [];
    const gh = batchGh();
    const f = collectFacts(
      7,
      batchDeps(
        (args) => {
          calls.push(args.join(' '));
          return gh(args);
        },
        { readJourneyReport: (run) => (runs.push(run), report) },
      ),
    );
    expect(runs).toEqual([4242]);
    expect(f.journey).toEqual({ feature: 'data', entries: [] });
    expect(calls).toContain(
      'issue list -R picasso-canvas/letzeuspost --label feature:data --state open --limit 1000 --json number',
    );
  });

  it('has no report to read without a services run or its artifact, and says why one is unreadable', () => {
    const none = collectFacts(
      7,
      batchDeps(batchGh({ 'check-runs': '' }), { readJourneyReport: () => report }),
    );
    expect(none.journey).toEqual({ feature: 'data', entries: null });
    const gone = collectFacts(7, batchDeps(batchGh(), { readJourneyReport: () => null }));
    expect(gone.journey).toEqual({ feature: 'data', entries: null });
    const bad = collectFacts(
      7,
      batchDeps(batchGh(), { readJourneyReport: () => ({ 'vitest.json': 'nope' }) }),
    );
    expect(bad.journey).toEqual({
      feature: 'data',
      entries: null,
      unreadable: "vitest.json isn't JSON",
    });
  });

  it("doesn't hold a part of a feature (a task of it is still open elsewhere), a batch with no feature, or a PR into staging", () => {
    const read = () => {
      throw new Error('not read');
    };
    const part = collectFacts(
      7,
      batchDeps(
        batchGh({
          'issue list -R picasso-canvas/letzeuspost --label feature:data': JSON.stringify([
            { number: 72 },
            { number: 73 },
          ]),
        }),
        {
          readJourneyReport: read,
        },
      ),
    );
    expect(part.journey).toBeNull();
    const noFeature = collectFacts(
      7,
      batchDeps(
        batchGh({
          'issue view 72 ': JSON.stringify({ labels: [{ name: 'build-task' }], body: 'x' }),
        }),
        {
          readJourneyReport: read,
        },
      ),
    );
    expect(noFeature.journey).toBeNull();
    expect(collectFacts(7, deps({ readJourneyReport: read })).journey).toBeNull();
  });

  it('refuses to guess when a batch closes tasks of two features', () => {
    expect(() =>
      collectFacts(
        7,
        batchDeps(
          batchGh({
            'issue view 148 ': JSON.stringify({
              labels: [{ name: 'build-task' }, { name: 'feature:sign-in' }],
              body: 'x',
            }),
          }),
          { readJourneyReport: () => report },
        ),
      ),
    ).toThrow('closes tasks of two features (data, sign-in)');
  });
});

describe("collectFacts: an earlier batch's follow-ups (#154)", () => {
  const batchView = JSON.stringify({
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'staging',
    headRefOid: SHA,
    title: '[Batch] 2 tasks',
    mergeable: 'MERGEABLE',
    body: 'Closes #42',
    labels: [{ name: 'sensitive' }],
    closingIssuesReferences: [],
  });
  it('gathers the open issues, the merged batches and the PR comments for a batch, and nothing for any other PR', () => {
    const calls: string[] = [];
    const gh = fakeGh({
      'pr view': batchView,
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [{ author: { login: 'picasso-canvas' }, body: 'Follow-up: #148' }],
      }),
      'issue list': JSON.stringify([
        { number: 148, labels: [{ name: 'follow-up' }], body: '**Follow-up of:** #130' },
        { number: 72, labels: [{ name: 'build-task' }], body: '- [ ] a test (follow-up of #130)' },
        { number: 73, labels: [{ name: 'build-task' }], body: 'x' },
      ]),
      'issue view 72 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [],
      }),
      'issue view 148 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [{ author: { login: 'picasso-canvas' }, body: 'a note' }],
      }),
      'log --first-parent': '',
    });
    const f = collectFacts(
      7,
      deps({
        gh: (args) => {
          calls.push(args.join(' '));
          return gh(args);
        },
        git: (args) => (args[0] === 'log' ? '' : fakeGit()(args)),
        readMergeLog: () => [
          { result: 'merged', base: 'main', kind: 'batch', pr: 130 },
          { result: 'merged', base: 'staging', issue: 42, pr: 50 },
        ],
      }),
    );
    expect(f.mergedBatches).toEqual([130]);
    // A follow-up's comments come in full, with their authors, and so do a planned task's with an unticked follow-up
    // item (Argus F2 in round 2); other open issues need only their text.
    expect(f.openIssues).toEqual([
      {
        number: 148,
        labels: ['follow-up'],
        body: '**Follow-up of:** #130',
        comments: [{ author: 'picasso-canvas', body: 'a note' }],
      },
      {
        number: 72,
        labels: ['build-task'],
        body: '- [ ] a test (follow-up of #130)',
        comments: [],
      },
      { number: 73, labels: ['build-task'], body: 'x', comments: [] },
    ]);
    expect(calls).toContain('issue view 72 -R picasso-canvas/letzeuspost --json comments');
    expect(calls).not.toContain('issue view 73 -R picasso-canvas/letzeuspost --json comments');
    expect(f.openIssuesCutOff).toBe(false);
    expect(f.prComments).toEqual([{ author: 'picasso-canvas', body: 'Follow-up: #148' }]);

    calls.length = 0;
    const other = collectFacts(
      7,
      deps({ gh: (args) => (calls.push(args.join(' ')), fakeGh()(args)) }),
    );
    expect(other.openIssues).toEqual([]);
    expect(other.prComments).toEqual([]);
    expect(calls.some((c) => c.startsWith('issue list'))).toBe(false);
  });
});
