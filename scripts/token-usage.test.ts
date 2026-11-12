import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collect,
  openProposals,
  parseDecisions,
  parseTranscript,
  priceOf,
  propose,
  renderReport,
  repoRelative,
  roleOf,
  sumBy,
  unpriced,
  type Call,
  type Prices,
  type SessionStats,
} from './token-usage.ts';

const prices: Prices = {
  asOf: '2026-10-06',
  cacheWriteMultiplier: 1.25,
  models: {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  },
};

const line = (o: unknown) => JSON.stringify(o);

const assistant = (
  id: string,
  ts: string,
  usage: Record<string, number>,
  content: unknown[] = [],
  model = 'claude-opus-5-5',
) => line({ type: 'assistant', timestamp: ts, message: { id, model, usage, content } });

const call = (over: Partial<Call> = {}): Call => ({
  day: '2026-11-12',
  role: 'athena',
  model: 'claude-opus-5-5',
  session: 's',
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  ...over,
});

const session = (over: Partial<SessionStats> = {}): SessionStats => ({
  id: 's',
  role: 'athena',
  model: 'claude-opus-5-5',
  calls: 0,
  prompts: 0,
  firstContext: 0,
  maxContext: 0,
  totalContext: 0,
  startedAt: '2026-11-12T00:00:00Z',
  endedAt: '2026-11-12T01:00:00Z',
  reads: {},
  commands: {},
  ...over,
});

describe('parseTranscript', () => {
  it('counts a message once however many lines repeat it', () => {
    const u = {
      input_tokens: 10,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 1000,
      output_tokens: 5,
    };
    const text = [
      assistant('m1', '2026-11-12T10:00:00Z', u),
      assistant('m1', '2026-11-12T10:00:01Z', u),
      assistant('m2', '2026-11-12T10:01:00Z', u),
    ].join('\n');
    const { calls, session: s } = parseTranscript(text, { role: 'athena', session: 'a' });
    expect(calls).toHaveLength(2);
    expect(s?.calls).toBe(2);
    expect(s?.totalContext).toBe(2 * 1110);
    expect(calls[0]).toMatchObject({
      day: '2026-11-12',
      input: 10,
      cacheWrite: 100,
      cacheRead: 1000,
      output: 5,
    });
  });

  it('skips lines that are not JSON, empty transcripts and synthetic messages', () => {
    expect(parseTranscript('not json\n\n{broken', { role: 'athena', session: 'a' })).toEqual({
      calls: [],
      session: null,
    });
    const text = assistant('m1', '2026-11-12T10:00:00Z', { input_tokens: 1 }, [], '<synthetic>');
    expect(parseTranscript(text, { role: 'athena', session: 'a' }).calls).toEqual([]);
  });

  it('counts real prompts, not system-injected ones', () => {
    const text = [
      line({ type: 'user', message: { content: 'build the thing' } }),
      line({ type: 'user', message: { content: '<system-reminder>x</system-reminder>' } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      assistant('m1', '2026-11-12T10:00:00Z', { input_tokens: 1 }),
    ].join('\n');
    expect(parseTranscript(text, { role: 'athena', session: 'a' }).session?.prompts).toBe(1);
  });

  it('keeps only counts for reads and the first 60 characters of commands', () => {
    const long = `echo ${'x'.repeat(200)}`;
    const text = [
      assistant('m1', '2026-11-12T10:00:00Z', { input_tokens: 1 }, [
        {
          type: 'tool_use',
          name: 'Read',
          input: { file_path: '/Users/me/Developer/picasso/letzeuspost/CLAUDE.md' },
        },
        { type: 'tool_use', name: 'Bash', input: { command: long } },
      ]),
    ].join('\n');
    const s = parseTranscript(text, { role: 'athena', session: 'a' }).session;
    expect(s?.reads).toEqual({ 'CLAUDE.md': 1 });
    expect(Object.keys(s?.commands ?? {})[0]).toHaveLength(60);
  });

  it('records the first and the largest context', () => {
    const text = [
      assistant('m1', '2026-11-12T10:00:00Z', { input_tokens: 10, cache_read_input_tokens: 90 }),
      assistant('m2', '2026-11-12T11:00:00Z', { input_tokens: 10, cache_read_input_tokens: 490 }),
    ].join('\n');
    const s = parseTranscript(text, { role: 'athena', session: 'a' }).session;
    expect(s).toMatchObject({
      firstContext: 100,
      maxContext: 500,
      startedAt: '2026-11-12T10:00:00Z',
      endedAt: '2026-11-12T11:00:00Z',
    });
  });
});

describe('roleOf', () => {
  it('tells Athena, builders and subagents apart', () => {
    expect(roleOf('-Users-picasso-Developer-picasso-letzeuspost', '/p/s.jsonl')).toBe('athena');
    expect(roleOf('-Users-picasso-Developer-picasso-letzeuspost', '/p/s/subagents/a.jsonl')).toBe(
      'subagent',
    );
    expect(roleOf('-Users-picasso-letzeuspost-builders-243-x', '/p/s.jsonl')).toBe('builder');
    expect(roleOf('-Users-picasso-other', '/p/s.jsonl')).toBe('other');
  });
});

describe('repoRelative', () => {
  it('drops the home directory and the repo prefix', () => {
    expect(repoRelative('/Users/me/Developer/picasso/letzeuspost/docs/a.md')).toBe('docs/a.md');
    expect(repoRelative('/Users/me/.letzeuspost/bundles/pr-9/argus/diff.patch')).toBe(
      '~bundle/diff.patch',
    );
    expect(repoRelative('/Users/me/notes.txt')).toBe('~/notes.txt');
  });
});

describe('cost', () => {
  it('prices each kind of token and applies the cache-write multiplier', () => {
    const c = call({
      input: 1_000_000,
      cacheWrite: 1_000_000,
      cacheRead: 1_000_000,
      output: 1_000_000,
    });
    expect(priceOf(c, prices)).toBeCloseTo(4 + 5 + 0.2 + 20);
  });

  it('prices an unknown model at zero and lists it', () => {
    const c = call({ model: 'claude-mystery', input: 1_000_000 });
    expect(priceOf(c, prices)).toBe(0);
    expect(unpriced([c, call()], prices)).toEqual(['claude-mystery']);
  });

  it('sums by a key', () => {
    const rows = sumBy(
      [call({ output: 1_000_000 }), call({ output: 1_000_000, role: 'builder' })],
      prices,
      (c) => c.role,
    );
    expect(rows.get('athena')?.cost).toBeCloseTo(20);
    expect(rows.get('builder')?.calls).toBe(1);
  });
});

describe('propose', () => {
  it('proposes nothing for a quiet window', () => {
    expect(propose([], [], prices)).toEqual([]);
  });

  it('flags sessions whose context stays large, with the cost above the line', () => {
    const s = session({ calls: 100, totalContext: 100 * 300_000, maxContext: 400_000 });
    const [p] = propose([], [s], prices);
    expect(p?.id).toBe('context-bloat');
    expect(p?.saving).toBeCloseTo((100 * 150_000 * 0.2) / 1_000_000);
  });

  it('flags Opus spend by builders and estimates the saving', () => {
    const calls = [call({ role: 'builder', output: 1_000_000 })];
    const p = propose(calls, [], prices).find((x) => x.id === 'opus-builder');
    expect(p?.saving).toBeCloseTo(20 * 0.5);
  });

  it('leaves a builder on Sonnet alone', () => {
    const calls = [call({ role: 'builder', model: 'claude-sonnet-5-5', output: 1_000_000 })];
    expect(propose(calls, [], prices).find((x) => x.id === 'opus-builder')).toBeUndefined();
  });

  it('flags repeated commands, many calls per prompt and re-read files', () => {
    const s = session({
      calls: 500,
      prompts: 5,
      commands: { 'gh pr checks 1': 9 },
      reads: { 'docs/a.md': 12 },
    });
    const ids = propose([], [s], prices).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['call-churn', 'polling', 'reread']));
  });

  it('does not count review bundles as re-read files, but flags Athena opening them', () => {
    const s = session({ reads: { '~bundle/diff.patch': 12 } });
    const ids = propose([], [s], prices).map((p) => p.id);
    expect(ids).toContain('athena-reads-bundles');
    expect(ids).not.toContain('reread');
  });

  it('flags forks that start large and long sessions', () => {
    const fork = session({ role: 'subagent', calls: 10, firstContext: 200_000 });
    const long = session({
      prompts: 30,
      startedAt: '2026-11-11T00:00:00Z',
      endedAt: '2026-11-11T20:00:00Z',
    });
    const ids = propose([], [fork, long], prices).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['fork-bloat', 'long-session']));
  });

  it('orders proposals by saving, biggest first, count-only ones last', () => {
    const s = session({ calls: 500, prompts: 5, totalContext: 500 * 300_000, maxContext: 400_000 });
    const ids = propose([], [s], prices).map((p) => p.id);
    expect(ids[0]).toBe('context-bloat');
    expect(ids[ids.length - 1]).toBe('call-churn');
  });
});

describe('decisions', () => {
  const md = [
    '| Proposal id | Decision | Date | Note |',
    '|---|---|---|---|',
    '| context-bloat | rejected | 2026-11-01 | too tight |',
    '| polling | approved | 2026-11-05 | |',
    '| reread | maybe | 2026-11-05 | not a status |',
    '| fork-bloat | rejected | yesterday | bad date |',
  ].join('\n');

  it('reads only well-formed rows', () => {
    expect(parseDecisions(md)).toEqual([
      { id: 'context-bloat', status: 'rejected', date: '2026-11-01' },
      { id: 'polling', status: 'approved', date: '2026-11-05' },
    ]);
  });

  it('hides a recent rejection and any approval, and brings a rejection back after 30 days', () => {
    const all = ['context-bloat', 'polling', 'reread'].map((id) => ({
      id,
      title: '',
      evidence: '',
      change: '',
      saving: null,
    }));
    const d = parseDecisions(md);
    expect(openProposals(all, d, '2026-11-12').map((p) => p.id)).toEqual(['reread']);
    expect(openProposals(all, d, '2026-12-05').map((p) => p.id)).toEqual([
      'context-bloat',
      'reread',
    ]);
  });
});

describe('renderReport', () => {
  it('shows the totals, the tables, the proposals and how Zeus decides, and no prompts or commands', () => {
    const calls = [call({ cacheRead: 2_000_000, output: 1_000_000 })];
    const body = renderReport({
      since: '2026-11-05',
      today: '2026-11-12',
      calls,
      prices,
      proposals: [
        { id: 'polling', title: '9 repeated commands', evidence: 'e', change: 'c', saving: 1.5 },
      ],
      suppressed: 1,
    });
    expect(body).toContain('## Token cost 2026-11-05 to 2026-11-12');
    expect(body).toContain('3.0M tokens in 1 API calls: 2.0M re-read from cache');
    expect(body).toContain('| athena | 1 |');
    expect(body).toContain('- [ ] **polling**: 9 repeated commands (about $1.50)');
    expect(body).toContain('`approve <id>`');
    expect(body).toContain('1 proposal(s) hidden');
  });

  it('says so when there is nothing to propose or a model is unpriced', () => {
    const body = renderReport({
      since: 'a',
      today: 'b',
      calls: [call({ model: 'claude-x' })],
      prices,
      proposals: [],
      suppressed: 0,
    });
    expect(body).toContain('None this week.');
    expect(body).toContain('Not priced');
  });
});

describe('collect', () => {
  it('reads the transcripts of this project only, and calls a one-prompt run in the main directory headless', () => {
    const root = mkdtempSync(join(tmpdir(), 'tokens-'));
    const main = join(root, '-Users-me-Developer-picasso-letzeuspost');
    mkdirSync(main);
    mkdirSync(join(root, '-Users-me-elsewhere'));
    const u = { input_tokens: 5, output_tokens: 1 };
    const asst = (id: string) => assistant(id, '2026-11-12T10:00:00Z', u);
    const prompt = (t: string) => line({ type: 'user', message: { content: t } });
    writeFileSync(join(main, 'review.jsonl'), [prompt('review PR 9'), asst('a')].join('\n'));
    writeFileSync(join(main, 'chat.jsonl'), [prompt('one'), prompt('two'), asst('b')].join('\n'));
    writeFileSync(join(root, '-Users-me-elsewhere', 'x.jsonl'), asst('c'));
    const { calls, sessions } = collect('2026-11-01', root);
    expect(calls.map((c) => c.role).sort()).toEqual(['athena', 'headless']);
    expect(sessions).toHaveLength(2);
    expect(collect('2026-11-13', root).calls).toEqual([]);
  });
});
