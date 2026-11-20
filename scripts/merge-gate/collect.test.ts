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
      body: '**Done when**\n- [ ] a\n- [ ] b (proof: ci:services)\n\n**Areas:** `packages/ui/**`',
    }),
    'check-runs':
      '{"name":"ci","status":"completed","conclusion":"success","app":"github-actions","sha":"abc1234"}\n',
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
  it("asks GitHub for each check run's commit, so a proof counts only on the head (#253)", () => {
    const asked: string[] = [];
    const gh = fakeGh();
    collectFacts(7, deps({ gh: (args) => (asked.push(args.join(' ')), gh(args)) }));
    expect(asked.find((call) => call.includes('/check-runs'))).toContain('sha: .head_sha');
  });

  it('reads the steps of a job a box names as its proof, on the head only (#264)', () => {
    const run = (sha: string) =>
      `${JSON.stringify({ name: 'services', status: 'completed', conclusion: 'success', app: 'github-actions', sha, url: 'https://github.com/picasso-canvas/letzeuspost/actions/runs/4242/job/99' })}\n`;
    const steps =
      '{"name":"Scope (x)","conclusion":"success"}\n{"name":"Scoped checks ran","conclusion":"skipped"}\n';
    const asked: string[] = [];
    const via = (check: string) => {
      const gh = fakeGh({ 'check-runs': check, 'actions/jobs/99': steps });
      asked.length = 0;
      return collectFacts(7, deps({ gh: (args) => (asked.push(args.join(' ')), gh(args)) }));
    };
    expect(via(run(SHA)).checkRuns[0]?.steps).toEqual([
      { name: 'Scope (x)', conclusion: 'success' },
      { name: 'Scoped checks ran', conclusion: 'skipped' },
    ]);
    expect(asked.some((call) => call.includes('actions/jobs/99'))).toBe(true);
    // An older commit's run, or a job no box names, costs no call.
    expect(via(run('0'.repeat(40))).checkRuns[0]?.steps).toBeUndefined();
    expect(asked.some((call) => call.includes('actions/jobs'))).toBe(false);
  });

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
        proofs: [null, 'ci:services'],
        areas: ['packages/ui/**'],
      },
      {
        number: 9,
        inRepo: false,
        labels: [],
        doneWhenBoxes: 0,
        proofs: [],
        areas: null,
      },
    ]);
    expect(f.checkRuns).toEqual([
      {
        name: 'ci',
        status: 'completed',
        conclusion: 'success',
        app: 'github-actions',
        sha: 'abc1234',
      },
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

  it('fetches origin/main before any diff against it, for either base', () => {
    for (const base of ['main', 'staging']) {
      const calls: string[][] = [];
      const git: CollectDeps['git'] = (args) => {
        calls.push(args);
        return fakeGit()(args);
      };
      const view = JSON.parse(fakeGh()(['pr', 'view'])) as object;
      const gh = fakeGh({
        'pr view': JSON.stringify({ ...view, baseRefName: base, headRefName: '42-thing' }),
      });
      collectFacts(7, deps({ git, gh }));
      const fetchMain = calls.findIndex((a) =>
        a.includes('+refs/heads/main:refs/remotes/origin/main'),
      );
      const firstDiff = calls.findIndex((a) => a[0] === 'diff');
      expect(fetchMain, base).toBeGreaterThanOrEqual(0);
      expect(fetchMain, base).toBeLessThan(firstDiff);
    }
  });

  it('refuses when origin/main is not the checkout the gate verified', () => {
    const git: CollectDeps['git'] = (args) => {
      if (args[0] === 'rev-parse' && args.includes('refs/remotes/origin/main'))
        return `${'c'.repeat(40)}\n`;
      return fakeGit()(args);
    };
    expect(() => collectFacts(7, deps({ git }))).toThrow(/main moved while checking/);
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
        { number: 72, labels: [{ name: 'build-task' }] },
      ]),
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'check-runs': `${JSON.stringify({ name: 'services', status: 'completed', conclusion: 'success', app: 'github-actions', url: RUN_URL })}\n`,
      ...over,
    });
  const batchDeps = (gh: CollectDeps['gh'], over: Partial<CollectDeps> = {}) =>
    deps({
      gh,
      git: (args) =>
        args[0] === 'log'
          ? ''
          : args[0] === 'ls-tree'
            ? 'tests/journeys/data.int.test.ts\ntests/journeys/sign-in.spec.ts\n'
            : fakeGit()(args),
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
    expect(f.journeys).toEqual([
      {
        feature: 'data',
        entries: [],
        files: ['tests/journeys/data.int.test.ts', 'tests/journeys/sign-in.spec.ts'],
      },
    ]);
    expect(calls).toContain(
      'issue list -R picasso-canvas/letzeuspost --label feature:data --state open --limit 1000 --json number,labels',
    );
    // The head commit's journey files, so one no runner reported is caught (Argus F1 in round 2 on #171).
  });

  it('has no report to read without a services run or its artifact, and says why one is unreadable', () => {
    const none = collectFacts(
      7,
      batchDeps(batchGh({ 'check-runs': '' }), { readJourneyReport: () => report }),
    );
    expect(none.journeys).toEqual([
      {
        feature: 'data',
        entries: null,
        files: ['tests/journeys/data.int.test.ts', 'tests/journeys/sign-in.spec.ts'],
      },
    ]);
    const gone = collectFacts(7, batchDeps(batchGh(), { readJourneyReport: () => null }));
    expect(gone.journeys).toEqual([
      {
        feature: 'data',
        entries: null,
        files: ['tests/journeys/data.int.test.ts', 'tests/journeys/sign-in.spec.ts'],
      },
    ]);
    const bad = collectFacts(
      7,
      batchDeps(batchGh(), { readJourneyReport: () => ({ 'vitest.json': 'nope' }) }),
    );
    expect(bad.journeys).toEqual([
      {
        feature: 'data',
        entries: null,
        unreadable: "vitest.json isn't JSON",
        files: ['tests/journeys/data.int.test.ts', 'tests/journeys/sign-in.spec.ts'],
      },
    ]);
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
            { number: 72, labels: [{ name: 'build-task' }] },
            { number: 73, labels: [{ name: 'build-task' }] },
          ]),
        }),
        {
          readJourneyReport: read,
        },
      ),
    );
    expect(part.journeys).toEqual([]);
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
    expect(noFeature.journeys).toEqual([]);
    expect(collectFacts(7, deps({ readJourneyReport: read })).journeys).toEqual([]);
  });

  describe('a batch that closes several features (#265)', () => {
    const two = (over: Record<string, string> = {}) =>
      batchGh({
        'issue view 148 ': JSON.stringify({
          labels: [{ name: 'build-task' }, { name: 'feature:sign-in' }],
          body: '**Done when**\n- [ ] a',
        }),
        'issue list -R picasso-canvas/letzeuspost --label feature:sign-in': JSON.stringify([
          { number: 148, labels: [{ name: 'build-task' }] },
        ]),
        ...over,
      });

    it('builds one journey per complete feature, from one read of the services run', () => {
      const runs: number[] = [];
      const f = collectFacts(
        7,
        batchDeps(two(), { readJourneyReport: (run) => (runs.push(run), report) }),
      );
      expect(runs).toEqual([4242]);
      expect(f.journeys.map((j) => j.feature)).toEqual(['data', 'sign-in']);
      expect(f.journeys.every((j) => j.entries?.length === 0)).toBe(true);
      expect(f.journeyParts).toEqual([]);
    });

    it('holds a complete feature by its journey and names the other as a part when its tasks are still open', () => {
      const f = collectFacts(
        7,
        batchDeps(
          two({
            'issue list -R picasso-canvas/letzeuspost --label feature:sign-in': JSON.stringify([
              { number: 148, labels: [{ name: 'build-task' }] },
              { number: 149, labels: [{ name: 'build-task' }] },
            ]),
          }),
          { readJourneyReport: () => report },
        ),
      );
      expect(f.journeys.map((j) => j.feature)).toEqual(['data']);
      expect(f.journeyParts).toEqual([{ feature: 'sign-in', open: [149] }]);
    });
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
      'pr view 130 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [{ author: { login: 'picasso-canvas' }, body: 'Follow-up: #148' }],
      }),
      'issue list': JSON.stringify([
        { number: 148, labels: [{ name: 'follow-up' }], body: '**Follow-up of:** #130' },
        { number: 72, labels: [{ name: 'build-task' }], body: '- [ ] a test (follow-up of #130)' },
        { number: 73, labels: [{ name: 'build-task' }], body: 'x' },
      ]),
      'issue list -R picasso-canvas/letzeuspost --state closed': '[]',
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
    expect(f.closedFollowUps).toEqual([]);
    expect(f.closedCutOff).toBe(false);
    expect(f.prComments).toEqual([{ author: 'picasso-canvas', body: 'Follow-up: #148' }]);

    calls.length = 0;
    const other = collectFacts(
      7,
      deps({ gh: (args) => (calls.push(args.join(' ')), fakeGh()(args)) }),
    );
    expect(other.openIssues).toEqual([]);
    expect(other.prComments).toEqual([]);
    expect(calls.some((c) => c.startsWith('issue list'))).toBe(false);
    expect(other.closedFollowUps).toEqual([]);
    expect(other.closedCutOff).toBe(false);
  });

  // #275: a follow-up closed by hand, or as not planned, hasn't landed. Its closing PRs are asked whether they merged,
  // and its comments are read only when it didn't land (an exception can be there).
  it("gathers a closed follow-up with how many of its closing PRs merged, and its comments only when it didn't land", () => {
    const calls: string[] = [];
    const gh = fakeGh({
      'pr view': batchView,
      'pr view 130 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'issue list -R picasso-canvas/letzeuspost --state open': '[]',
      'issue list -R picasso-canvas/letzeuspost --state closed': JSON.stringify([
        {
          number: 150,
          labels: [{ name: 'follow-up' }],
          body: '**Follow-up of:** #130',
          stateReason: 'COMPLETED',
          closedByPullRequestsReferences: [
            { number: 160, url: 'https://github.com/picasso-canvas/letzeuspost/pull/160' },
            { number: 161, url: 'https://github.com/picasso-canvas/letzeuspost/pull/161' },
            { number: 162, url: 'https://github.com/someone/else/pull/162' },
          ],
        },
        {
          number: 151,
          labels: [{ name: 'follow-up' }],
          body: '**Follow-up of:** #130',
          stateReason: 'NOT_PLANNED',
          closedByPullRequestsReferences: [],
        },
        // Not a follow-up (no line): the gate reads the whole closed list, not a search, so it filters here.
        {
          number: 152,
          labels: [{ name: 'build-task' }],
          body: 'a task',
          stateReason: 'COMPLETED',
          closedByPullRequestsReferences: [
            { number: 163, url: 'https://github.com/picasso-canvas/letzeuspost/pull/163' },
          ],
        },
      ]),
      // Another repository's PR with the same number is no closer of ours.
      'pr view 162 -R picasso-canvas/letzeuspost --json state': 'MERGED\n',
      'pr view 160 -R picasso-canvas/letzeuspost --json state': 'CLOSED\n',
      'pr view 161 -R picasso-canvas/letzeuspost --json state': 'MERGED\n',
      'issue view 151 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [{ author: { login: 'picasso-canvas' }, body: 'a note' }],
      }),
      'log --first-parent': '',
    });
    const f = collectFacts(
      7,
      deps({
        gh: (args) => (calls.push(args.join(' ')), gh(args)),
        git: (args) => (args[0] === 'log' ? '' : fakeGit()(args)),
        readMergeLog: () => [{ result: 'merged', base: 'main', kind: 'batch', pr: 130 }],
      }),
    );
    expect(f.closedFollowUps).toEqual([
      {
        number: 150,
        labels: ['follow-up'],
        body: '**Follow-up of:** #130',
        stateReason: 'COMPLETED',
        mergedClosers: 1,
        comments: [],
      },
      {
        number: 151,
        labels: ['follow-up'],
        body: '**Follow-up of:** #130',
        stateReason: 'NOT_PLANNED',
        mergedClosers: 0,
        comments: [{ author: 'picasso-canvas', body: 'a note' }],
      },
    ]);
    expect(calls).not.toContain('issue view 150 -R picasso-canvas/letzeuspost --json comments');
    expect(calls.some((c) => c.includes('--search'))).toBe(false);
    expect(calls.some((c) => c.startsWith('pr view 162') || c.startsWith('pr view 163'))).toBe(
      false,
    );
    expect(f.closedCutOff).toBe(false);
  });

  // #277: Athena's `Follow-up: #N` lines on an earlier batch are read, and the issues they name are gathered even when
  // the issue's own **Follow-up of:** line was edited out before it was closed.
  it("reads each earlier batch's comments, and gathers a closed issue it links though its line is gone", () => {
    const calls: string[] = [];
    const gh = fakeGh({
      'pr view': batchView,
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'pr view 130 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [
          { author: { login: 'picasso-canvas' }, body: 'Follow-up: #153' },
          { author: null, body: 'Follow-up: #154' },
        ],
      }),
      'issue list -R picasso-canvas/letzeuspost --state open': '[]',
      'issue list -R picasso-canvas/letzeuspost --state closed': JSON.stringify([
        {
          number: 153,
          labels: [{ name: 'follow-up' }],
          body: 'the line was edited out',
          stateReason: 'NOT_PLANNED',
          closedByPullRequestsReferences: [],
        },
        // Not linked and no line: not gathered.
        {
          number: 155,
          labels: [{ name: 'build-task' }],
          body: 'a task',
          stateReason: 'COMPLETED',
          closedByPullRequestsReferences: [],
        },
      ]),
      'issue view 153 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [],
      }),
      'log --first-parent': '',
    });
    const f = collectFacts(
      7,
      deps({
        gh: (args) => (calls.push(args.join(' ')), gh(args)),
        git: (args) => (args[0] === 'log' ? '' : fakeGit()(args)),
        readMergeLog: () => [
          { result: 'merged', base: 'main', kind: 'batch', pr: 130 },
          { result: 'merged', base: 'main', kind: 'batch', pr: 7 },
        ],
      }),
    );
    expect(f.earlierBatchComments).toEqual([
      {
        batch: 130,
        comments: [
          { author: 'picasso-canvas', body: 'Follow-up: #153' },
          { author: '', body: 'Follow-up: #154' },
        ],
      },
    ]);
    expect(f.closedFollowUps.map((i) => i.number)).toEqual([153]);
    // This batch's own comments are read once, as before; a PR into staging reads none.
    expect(
      calls.filter((c) => c === 'pr view 7 -R picasso-canvas/letzeuspost --json comments'),
    ).toHaveLength(1);
  });

  // Argus F1 and Cerberus F1 on #290: an open issue an earlier batch linked may have lost its label and line, and Zeus's
  // exception on it is in its comments, so they are read for it too.
  it('reads the comments of an open issue an earlier batch linked, though its label and line are gone', () => {
    const gh = fakeGh({
      'pr view': batchView,
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'pr view 130 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [{ author: { login: 'picasso-canvas' }, body: 'Follow-up: #300' }],
      }),
      'issue list': JSON.stringify([
        { number: 300, labels: [{ name: 'build-task' }], body: 'the line was edited out' },
        { number: 301, labels: [{ name: 'build-task' }], body: 'unrelated' },
      ]),
      'issue list -R picasso-canvas/letzeuspost --state closed': '[]',
      'issue view 300 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({
        comments: [{ author: { login: 'picasso-canvas' }, body: 'an exception, maybe' }],
      }),
      'log --first-parent': '',
    });
    const calls: string[] = [];
    const f = collectFacts(
      7,
      deps({
        gh: (args) => (calls.push(args.join(' ')), gh(args)),
        git: (args) => (args[0] === 'log' ? '' : fakeGit()(args)),
        readMergeLog: () => [{ result: 'merged', base: 'main', kind: 'batch', pr: 130 }],
      }),
    );
    expect(f.openIssues.find((i) => i.number === 300)?.comments).toEqual([
      { author: 'picasso-canvas', body: 'an exception, maybe' },
    ]);
    expect(calls).not.toContain('issue view 301 -R picasso-canvas/letzeuspost --json comments');
  });

  it('flags a closed list that reaches its limit as cut off', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      number: 1000 + i,
      labels: [{ name: 'follow-up' }],
      body: '**Follow-up of:** #130',
      stateReason: 'COMPLETED',
      closedByPullRequestsReferences: [
        { number: 5, url: 'https://github.com/picasso-canvas/letzeuspost/pull/5' },
      ],
    }));
    const gh = fakeGh({
      'pr view': batchView,
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'issue list -R picasso-canvas/letzeuspost --state open': '[]',
      'issue list -R picasso-canvas/letzeuspost --state closed': JSON.stringify(many),
      'pr view 5 -R picasso-canvas/letzeuspost --json state': 'MERGED\n',
      'log --first-parent': '',
    });
    const f = collectFacts(
      7,
      deps({
        gh,
        git: (args) => (args[0] === 'log' ? '' : fakeGit()(args)),
        readMergeLog: () => [],
      }),
    );
    expect(f.closedCutOff).toBe(true);
  });
});

describe('collectFacts: what makes a part of a feature (Argus F3-F4, Cerberus F2 on #171)', () => {
  const view = (refs: { number: number; url: string }[]) =>
    JSON.stringify({
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
      closingIssuesReferences: refs,
    });
  const own = { number: 72, url: 'https://github.com/picasso-canvas/letzeuspost/issues/72' };
  const gh = (featureList: unknown[], refs = [own]) =>
    fakeGh({
      'pr view': view(refs),
      'issue view 72 ': JSON.stringify({
        labels: [{ name: 'build-task' }, { name: 'feature:data' }],
        body: 'x',
      }),
      'issue list': '[]',
      'issue list -R picasso-canvas/letzeuspost --label feature:data': JSON.stringify(featureList),
      'pr view 7 -R picasso-canvas/letzeuspost --json comments': JSON.stringify({ comments: [] }),
      'check-runs': `${JSON.stringify({ name: 'services', status: 'completed', conclusion: 'success', app: 'github-actions', url: 'https://github.com/picasso-canvas/letzeuspost/actions/runs/4242/job/99' })}\n`,
    });
  const run = (g: CollectDeps['gh']) =>
    collectFacts(
      7,
      deps({
        gh: g,
        git: (args) =>
          args[0] === 'log'
            ? ''
            : args[0] === 'ls-tree'
              ? 'tests/journeys/data.int.test.ts\ntests/journeys/sign-in.spec.ts\n'
              : fakeGit()(args),
        readJourneyReport: () => ({ 'vitest.json': '[]' }),
      }),
    );
  const task = (number: number) => ({
    number,
    labels: [{ name: 'build-task' }, { name: 'feature:data' }],
  });

  it('counts only open build tasks: a stray issue with the label still leaves the batch held', () => {
    const f = run(gh([task(72), { number: 90, labels: [{ name: 'feature:data' }] }]));
    expect(f.journeys).toEqual([
      {
        feature: 'data',
        entries: [],
        files: ['tests/journeys/data.int.test.ts', 'tests/journeys/sign-in.spec.ts'],
      },
    ]);
    expect(f.journeyParts).toEqual([]);
  });

  it('says which open tasks make a batch a part, so the gate can show why it is not held', () => {
    const f = run(gh([task(72), task(73)]));
    expect(f.journeys).toEqual([]);
    expect(f.journeyParts).toEqual([{ feature: 'data', open: [73] }]);
  });

  it("doesn't take another repository's issue for one of this feature's tasks", () => {
    const f = run(
      gh(
        [task(72), task(73)],
        [own, { number: 73, url: 'https://github.com/someone/else/issues/73' }],
      ),
    );
    expect(f.journeyParts).toEqual([{ feature: 'data', open: [73] }]);
  });
});
