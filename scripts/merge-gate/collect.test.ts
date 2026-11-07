import { describe, expect, it } from 'vitest';
import { collectFacts, parseConfig, type CollectDeps } from './collect.ts';

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
      body: '**Done when**\n- [ ] a\n- [ ] b',
    }),
    'check-runs':
      '{"name":"ci","status":"completed","conclusion":"success","app":"github-actions"}\n',
    status: '',
    ...overrides,
  };
  return (args) => {
    const joined = args.join(' ');
    const key = Object.keys(answers).find((k) => joined.includes(k));
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
      { number: 42, inRepo: true, labels: ['build-task'], doneWhenBoxes: 2 },
      { number: 9, inRepo: false, labels: [], doneWhenBoxes: 0 },
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
    const bundle = `${'/s'}/bundles/pr-7/${SHA.slice(0, 7)}-1`;
    const good = {
      pr: 7,
      sha: SHA,
      reviewer: 'argus' as const,
      verdict: 'pass' as const,
      bodyHash: 'h',
      summary: 'VERDICT: pass',
      at: '',
      meta: { agent: 'argus-reviewer', sessionId: 's-ok', bundle },
    };
    const forged = { ...good, meta: { agent: 'argus-reviewer', sessionId: 's-fake', bundle } };
    const f = collectFacts(
      7,
      deps({
        readReviews: () => [good, forged],
        readTranscript: (id) =>
          id === 's-ok'
            ? [
                JSON.stringify({ type: 'agent-setting', agentSetting: 'argus-reviewer' }),
                JSON.stringify({ type: 'user', message: { content: `Review … ${bundle}/ …` } }),
                JSON.stringify({
                  type: 'assistant',
                  message: { content: [{ type: 'text', text: 'VERDICT: pass' }] },
                }),
              ].join('\n')
            : null,
        stateDir: '/s',
      }),
    );
    expect(f.reviews.map((r) => r.meta?.verified)).toEqual([true, false]);
  });
});
