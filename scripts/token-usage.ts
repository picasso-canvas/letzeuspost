#!/usr/bin/env node
// The token log and its proposals (Zeus, 2026-11-12). Counts what Claude Code sessions sent and wrote, prices it,
// and proposes savings. It never changes anything: Zeus decides each proposal on the record (docs/ops/token-decisions.md).
//   node scripts/token-usage.ts [--since YYYY-MM-DD] [--json] [--post]
// Reads ~/.claude/projects/*letzeuspost*/**/*.jsonl. Only numbers and repo-relative file names leave the transcripts:
// never prompts, answers, commands or tool output. A message is counted once however many lines repeat it.
// Prints the report. --post adds it as a comment on the open `token-review` issue (creating the issue the first time).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/entry.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const PRICES_FILE = join(HERE, '..', 'docs', 'ops', 'token-prices.json');
export const DECISIONS_FILE = join(HERE, '..', 'docs', 'ops', 'token-decisions.md');
export const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export type Role = 'athena' | 'headless' | 'builder' | 'subagent' | 'other';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}
/** Dollars per million tokens. `cacheWriteMultiplier` is applied to `input` for tokens written to the cache. */
export interface Prices {
  asOf: string;
  cacheWriteMultiplier: number;
  models: Record<string, ModelPrice>;
}

export interface Call {
  day: string;
  role: Role;
  model: string;
  session: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export interface SessionStats {
  id: string;
  role: Role;
  model: string;
  calls: number;
  prompts: number;
  firstContext: number;
  maxContext: number;
  totalContext: number;
  startedAt: string;
  endedAt: string;
  /** Repo-relative file → times read in this session. */
  reads: Record<string, number>;
  /** A command's first 60 characters → times run (only counted here; never leaves this module). */
  commands: Record<string, number>;
}

export interface Totals {
  calls: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  cost: number;
}

/** Thresholds for the proposals, in one place so a decision can name the one it tunes. */
export const RULES = {
  bloatedContext: 150_000,
  callsPerPrompt: 40,
  pollRepeat: 8,
  rereadTimes: 10,
  athenaBundleReads: 5,
  forkStart: 150_000,
  longSessionHours: 12,
  longSessionPrompts: 20,
  opusShare: 0.2,
  /** Average context per call (tokens) where a task turns amber and red. From the 30 builder tasks of 2026-11-12. */
  healthAmber: 60_000,
  healthRed: 110_000,
} as const;

export function totalContext(c: Pick<Call, 'input' | 'cacheWrite' | 'cacheRead'>): number {
  return c.input + c.cacheWrite + c.cacheRead;
}

export function roleOf(projectDir: string, file: string): Role {
  if (file.includes(`${sep}subagents${sep}`)) return 'subagent';
  if (/^-Users-[^/]*-letzeuspost-builders-/.test(projectDir)) return 'builder';
  if (/^-Users-[^/]*-Developer-picasso-letzeuspost(-wt-.*)?$/.test(projectDir)) return 'athena';
  return 'other';
}

/** A path as the repo knows it: the harness and builder clones' prefixes and the home directory are dropped. */
export function repoRelative(path: string): string {
  return path
    .replace(/^.*\/\.letzeuspost\/bundles\/pr-\d+\/[^/]+\//, '~bundle/')
    .replace(/^.*\/letzeuspost-builders\/[^/]+\//, '')
    .replace(/^.*\/letzeuspost(-wt\/[^/]+)?\//, '')
    .replace(/^\/Users\/[^/]+\//, '~/');
}

interface Line {
  type?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, number | undefined>;
  };
}

/** One transcript's calls (each message once) and its session statistics. Lines that aren't JSON are skipped. */
export function parseTranscript(
  text: string,
  meta: { role: Role; session: string },
): { calls: Call[]; session: SessionStats | null } {
  const seen = new Set<string>();
  const calls: Call[] = [];
  const s: SessionStats = {
    id: meta.session,
    role: meta.role,
    model: '',
    calls: 0,
    prompts: 0,
    firstContext: 0,
    maxContext: 0,
    totalContext: 0,
    startedAt: '',
    endedAt: '',
    reads: {},
    commands: {},
  };
  for (const raw of text.split('\n')) {
    if (raw === '') continue;
    let o: Line;
    try {
      o = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    const m = o.message;
    const ts = o.timestamp ?? '';
    if (o.type === 'user' && typeof m?.content === 'string' && !m.content.startsWith('<')) {
      s.prompts += 1;
    }
    if (o.type !== 'assistant' || m?.usage === undefined) continue;
    if (m.id !== undefined) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
    }
    const u = m.usage;
    const call: Call = {
      day: ts.slice(0, 10),
      role: meta.role,
      model: m.model ?? 'unknown',
      session: meta.session,
      input: u['input_tokens'] ?? 0,
      cacheWrite: u['cache_creation_input_tokens'] ?? 0,
      cacheRead: u['cache_read_input_tokens'] ?? 0,
      output: u['output_tokens'] ?? 0,
    };
    if (call.model === '<synthetic>') continue;
    calls.push(call);
    const ctx = totalContext(call);
    s.calls += 1;
    s.totalContext += ctx;
    s.maxContext = Math.max(s.maxContext, ctx);
    if (s.calls === 1) {
      s.firstContext = ctx;
      s.startedAt = ts;
      s.model = call.model;
    }
    s.endedAt = ts;
    if (Array.isArray(m.content)) {
      for (const b of m.content as {
        type?: string;
        name?: string;
        input?: Record<string, unknown>;
      }[]) {
        if (b.type !== 'tool_use') continue;
        const path = b.input?.['file_path'];
        if (b.name === 'Read' && typeof path === 'string') {
          const p = repoRelative(path);
          s.reads[p] = (s.reads[p] ?? 0) + 1;
        }
        const cmd = b.input?.['command'];
        if (b.name === 'Bash' && typeof cmd === 'string') {
          const k = cmd.trim().replace(/\s+/g, ' ').slice(0, 60);
          s.commands[k] = (s.commands[k] ?? 0) + 1;
        }
      }
    }
  }
  return { calls, session: s.calls === 0 ? null : s };
}

export function priceOf(call: Call, prices: Prices): number {
  const p = prices.models[call.model];
  if (p === undefined) return 0;
  return (
    (call.input * p.input +
      call.cacheWrite * p.input * prices.cacheWriteMultiplier +
      call.cacheRead * p.cacheRead +
      call.output * p.output) /
    1_000_000
  );
}

export function unpriced(calls: Call[], prices: Prices): string[] {
  return [...new Set(calls.map((c) => c.model))]
    .filter((m) => prices.models[m] === undefined)
    .sort();
}

const emptyTotals = (): Totals => ({
  calls: 0,
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  cost: 0,
});

export function sumBy(
  calls: Call[],
  prices: Prices,
  key: (c: Call) => string,
): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const c of calls) {
    const k = key(c);
    const t = out.get(k) ?? emptyTotals();
    t.calls += 1;
    t.input += c.input;
    t.cacheWrite += c.cacheWrite;
    t.cacheRead += c.cacheRead;
    t.output += c.output;
    t.cost += priceOf(c, prices);
    out.set(k, t);
  }
  return out;
}

export interface Proposal {
  id: string;
  title: string;
  evidence: string;
  change: string;
  /** Estimated dollars saved over the window, or null when the evidence is a count only. */
  saving: number | null;
}

const isOpus = (m: string) => m.includes('opus') || m.includes('fable');

/** Proposals from the window's calls and sessions. Pure: the same input gives the same list, ordered by saving. */
export function propose(calls: Call[], sessions: SessionStats[], prices: Prices): Proposal[] {
  const out: Proposal[] = [];
  const cacheReadPrice = (model: string) => prices.models[model]?.cacheRead ?? 0;

  // 1. Sessions whose context stays large: the cache read is paid again on every call.
  const bloated = sessions.filter(
    (s) =>
      s.role !== 'subagent' && s.calls >= 20 && s.totalContext / s.calls > RULES.bloatedContext,
  );
  if (bloated.length > 0) {
    let saving = 0;
    for (const s of bloated) {
      const excess = s.totalContext - s.calls * RULES.bloatedContext;
      saving += (excess * cacheReadPrice(s.model)) / 1_000_000;
    }
    const worst = Math.max(...bloated.map((s) => s.maxContext));
    out.push({
      id: 'context-bloat',
      title: `${String(bloated.length)} session(s) averaged over ${String(RULES.bloatedContext / 1000)}K of context per call`,
      evidence: `Largest context ${String(Math.round(worst / 1000))}K. Cost of the part above the line, at the cache-read price.`,
      change:
        'Lower CLAUDE_CODE_AUTO_COMPACT_WINDOW in .claude/settings.json, or /clear at task boundaries.',
      saving,
    });
  }

  // 2. Opus spend on work a cheaper model does: builders and forked agents.
  for (const role of ['builder', 'subagent'] as const) {
    const mine = calls.filter((c) => c.role === role);
    const total = mine.reduce((a, c) => a + priceOf(c, prices), 0);
    const opus = mine.filter((c) => isOpus(c.model));
    const opusCost = opus.reduce((a, c) => a + priceOf(c, prices), 0);
    if (total > 0 && opusCost / total > RULES.opusShare) {
      const sonnet = prices.models['claude-sonnet-5-5'];
      const opusP = prices.models['claude-opus-5-5'];
      const ratio = sonnet !== undefined && opusP !== undefined ? sonnet.input / opusP.input : 0.5;
      out.push({
        id: `opus-${role}`,
        title: `${String(Math.round((100 * opusCost) / total))}% of ${role} spend ran on Opus`,
        evidence: `${String(opus.length)} calls on Opus. Saving assumes Sonnet costs ${String(Math.round(ratio * 100))}% of Opus per token.`,
        change:
          role === 'builder'
            ? "Check the issue's Predicted tier and scripts/dispatch.ts builderModel: only sensitive tasks need Opus."
            : 'Give forked agents a model of their own, or use a fresh agent with a short brief.',
        saving: opusCost * (1 - ratio),
      });
    }
  }

  // 3. Many calls per prompt: each one re-sends the context.
  const athena = sessions.filter((s) => s.role === 'athena' && s.prompts >= 3);
  const busy = athena.filter((s) => s.calls / s.prompts > RULES.callsPerPrompt);
  if (busy.length > 0) {
    const calls_ = busy.reduce((a, s) => a + s.calls, 0);
    const prompts = busy.reduce((a, s) => a + s.prompts, 0);
    out.push({
      id: 'call-churn',
      title: `${String(busy.length)} Athena session(s) made over ${String(RULES.callsPerPrompt)} API calls per prompt`,
      evidence: `${String(Math.round(calls_ / prompts))} calls per prompt on average, ${String(calls_)} calls in all.`,
      change:
        'Fold the repeated stage into one script call that prints one summary line (scripts/*.ts).',
      saving: null,
    });
  }

  // 4. The same command again and again in one session: a poll.
  let polls = 0;
  let pollSessions = 0;
  for (const s of sessions) {
    const rep = Object.values(s.commands).filter((n) => n >= RULES.pollRepeat);
    if (rep.length > 0) pollSessions += 1;
    polls += rep.reduce((a, n) => a + n, 0);
  }
  if (pollSessions > 0) {
    out.push({
      id: 'polling',
      title: `${String(polls)} repeated shell commands in ${String(pollSessions)} session(s)`,
      evidence: `A command run ${String(RULES.pollRepeat)} or more times in one session is counted. Commands are not shown.`,
      change:
        'Wait with one command that returns when the work is done, or a background run, not repeated checks.',
      saving: null,
    });
  }

  // 5. The same file read many times across sessions.
  const reads = new Map<string, number>();
  for (const s of sessions)
    for (const [p, n] of Object.entries(s.reads)) reads.set(p, (reads.get(p) ?? 0) + n);
  const reread = [...reads].filter(([p, n]) => n >= RULES.rereadTimes && !p.startsWith('~bundle/'));
  if (reread.length > 0) {
    reread.sort((a, b) => b[1] - a[1]);
    out.push({
      id: 'reread',
      title: `${String(reread.length)} file(s) read ${String(RULES.rereadTimes)} or more times`,
      evidence: reread
        .slice(0, 5)
        .map(([p, n]) => `${p} ×${String(n)}`)
        .join('; '),
      change:
        'Shorten the file or move what the agents need into their agent file; read the rest only when the task touches it.',
      saving: null,
    });
  }

  // 6. Athena reading review bundles herself (CLAUDE.md: only the reviewers read them).
  const bundleReads = sessions
    .filter((s) => s.role === 'athena')
    .reduce(
      (a, s) =>
        a +
        Object.entries(s.reads)
          .filter(([p]) => p.startsWith('~bundle/'))
          .reduce((b, [, n]) => b + n, 0),
      0,
    );
  if (bundleReads >= RULES.athenaBundleReads) {
    out.push({
      id: 'athena-reads-bundles',
      title: `Athena opened review bundle files ${String(bundleReads)} times`,
      evidence: 'CLAUDE.md says only the reviewer agents read diff.patch and the bundle.',
      change: 'Have scripts/review.ts print the verdict and findings only; Athena reads those.',
      saving: null,
    });
  }

  // 7. Forked agents that start with a large inherited context.
  const forks = sessions.filter((s) => s.role === 'subagent' && s.firstContext > RULES.forkStart);
  if (forks.length > 0) {
    const cost = forks.reduce(
      (a, s) => a + (s.firstContext * s.calls * cacheReadPrice(s.model)) / 1_000_000,
      0,
    );
    out.push({
      id: 'fork-bloat',
      title: `${String(forks.length)} forked agent(s) started above ${String(RULES.forkStart / 1000)}K of context`,
      evidence:
        'A fork inherits the whole conversation. Cost is the inherited part re-read on each of its calls.',
      change: 'Use a fresh agent with a short brief instead of a fork from a long session.',
      saving: cost,
    });
  }

  // 8. Sessions that ran for hours with many prompts and no clear.
  const long = sessions.filter(
    (s) =>
      s.role === 'athena' &&
      s.prompts >= RULES.longSessionPrompts &&
      (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 3_600_000 > RULES.longSessionHours,
  );
  if (long.length > 0) {
    out.push({
      id: 'long-session',
      title: `${String(long.length)} Athena session(s) ran over ${String(RULES.longSessionHours)} hours with ${String(RULES.longSessionPrompts)}+ prompts`,
      evidence: 'No /clear at the task boundaries in between.',
      change:
        '/clear at every task boundary (already in CLAUDE.md); consider a hook that warns at a set age.',
      saving: null,
    });
  }

  return out.sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1));
}

export interface Decision {
  id: string;
  status: string;
  date: string;
}

/** Rows of docs/ops/token-decisions.md: `| <proposal id> | approved or rejected or applied | YYYY-MM-DD | note |`. */
export function parseDecisions(md: string): Decision[] {
  const rows: Decision[] = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const [, id, status, date] = cells;
    if (id === undefined || status === undefined || date === undefined) continue;
    if (!/^[a-z-]+$/.test(id) || !/^(approved|rejected|applied)$/.test(status)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({ id, status, date });
  }
  return rows;
}

/** A rejected proposal stays quiet for 30 days; an approved or applied one is Athena's to act on, not to propose again. */
export function openProposals(all: Proposal[], decisions: Decision[], today: string): Proposal[] {
  const day = Date.parse(today);
  return all.filter((p) => {
    const mine = decisions.filter((d) => d.id === p.id);
    if (mine.some((d) => d.status === 'approved' || d.status === 'applied')) return false;
    return !mine.some(
      (d) => d.status === 'rejected' && (day - Date.parse(d.date)) / 86_400_000 < 30,
    );
  });
}

const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
const mtok = (n: number) => `${(n / 1e6).toFixed(1)}M`;

export function renderReport(args: {
  since: string;
  today: string;
  calls: Call[];
  prices: Prices;
  proposals: Proposal[];
  suppressed: number;
}): string {
  const { calls, prices, proposals } = args;
  const grand = [...sumBy(calls, prices, () => 'all').values()][0] ?? emptyTotals();
  const lines: string[] = [];
  lines.push(`## Token cost ${args.since} to ${args.today}`, '');
  lines.push(
    `${mtok(grand.input + grand.cacheWrite + grand.cacheRead + grand.output)} tokens in ${String(grand.calls)} API calls: ${mtok(grand.cacheRead)} re-read from cache, ${mtok(grand.cacheWrite)} written to cache, ${mtok(grand.output)} output. Estimated ${money(grand.cost)} (prices as of ${prices.asOf}; cache writes at ${String(prices.cacheWriteMultiplier)}× input). Estimates, not the invoice.`,
    '',
  );
  const miss = unpriced(calls, prices);
  if (miss.length > 0)
    lines.push(`Not priced (add to docs/ops/token-prices.json): ${miss.join(', ')}.`, '');
  const table = (title: string, rows: Map<string, Totals>) => {
    lines.push(
      `| ${title} | calls | cache read | cache write | output | cost |`,
      '|---|---:|---:|---:|---:|---:|',
    );
    for (const [k, t] of [...rows].sort((a, b) => b[1].cost - a[1].cost)) {
      lines.push(
        `| ${k} | ${String(t.calls)} | ${mtok(t.cacheRead)} | ${mtok(t.cacheWrite)} | ${mtok(t.output)} | ${money(t.cost)} |`,
      );
    }
    lines.push('');
  };
  table(
    'Role',
    sumBy(calls, prices, (c) => c.role),
  );
  table(
    'Model',
    sumBy(calls, prices, (c) => c.model),
  );
  table(
    'Day',
    sumBy(calls, prices, (c) => c.day),
  );
  lines.push('### Proposals', '');
  if (proposals.length === 0) lines.push('None this week.', '');
  for (const p of proposals) {
    lines.push(
      `- [ ] **${p.id}**: ${p.title}${p.saving === null ? '' : ` (about ${money(p.saving)})`}`,
      `  - Evidence: ${p.evidence}`,
      `  - Change: ${p.change}`,
    );
  }
  lines.push(
    '',
    'Zeus decides each one: reply `approve <id>` or `reject <id> <reason>`. Athena records it in docs/ops/token-decisions.md and applies an approved one through a normal PR. Nothing here changes by itself.',
  );
  if (args.suppressed > 0)
    lines.push('', `${String(args.suppressed)} proposal(s) hidden: decided already.`);
  return lines.join('\n');
}

export function loadPrices(path = PRICES_FILE): Prices {
  return JSON.parse(readFileSync(path, 'utf8')) as Prices;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}

/** Every call and session since `since` (a call's day decides; a session is kept when it has a call in the window). */
export function collect(
  since: string,
  root = PROJECTS_DIR,
): { calls: Call[]; sessions: SessionStats[] } {
  const calls: Call[] = [];
  const sessions: SessionStats[] = [];
  if (!existsSync(root)) return { calls, sessions };
  for (const dir of readdirSync(root)) {
    if (!dir.includes('letzeuspost')) continue;
    for (const file of walk(join(root, dir))) {
      const role = roleOf(dir, file);
      if (role === 'other') continue;
      const { calls: cs, session } = parseTranscript(readFileSync(file, 'utf8'), {
        role,
        session: file.slice(root.length),
      });
      // A session in Athena's directory with a single prompt is a headless run (a reviewer or a script), not Athena.
      const headless = role === 'athena' && session !== null && session.prompts <= 1;
      const inWindow = cs
        .filter((c) => c.day >= since)
        .map((c) => (headless ? { ...c, role: 'headless' as const } : c));
      calls.push(...inWindow);
      if (session !== null && inWindow.length > 0)
        sessions.push(headless ? { ...session, role: 'headless' } : session);
    }
  }
  return { calls, sessions };
}

export type Health = 'green' | 'amber' | 'red';

/** The rating of a task by the average context its calls carried. Informational only, never a gate. */
export function healthOf(avgContext: number): Health {
  if (avgContext >= RULES.healthRed) return 'red';
  if (avgContext >= RULES.healthAmber) return 'amber';
  return 'green';
}

export interface TaskUsage {
  sessions: number;
  calls: number;
  tokens: number;
  /** Null when a model in the task has no price in docs/ops/token-prices.json. */
  cost: number | null;
  avgContext: number;
  peakContext: number;
  health: Health;
}

/** Everything the builder of one issue used: its sessions and forked agents, all rounds. Null when there is none. */
export function taskUsage(issue: number, prices: Prices, root = PROJECTS_DIR): TaskUsage | null {
  if (!existsSync(root)) return null;
  const mine = new RegExp(`^-Users-[^/]*-letzeuspost-builders-${String(issue)}-`);
  const calls: Call[] = [];
  let sessions = 0;
  let context = 0;
  let peak = 0;
  for (const dir of readdirSync(root)) {
    if (!mine.test(dir)) continue;
    for (const file of walk(join(root, dir))) {
      const parsed = parseTranscript(readFileSync(file, 'utf8'), {
        role: roleOf(dir, file),
        session: file.slice(root.length),
      });
      if (parsed.session === null) continue;
      sessions += 1;
      calls.push(...parsed.calls);
      context += parsed.session.totalContext;
      peak = Math.max(peak, parsed.session.maxContext);
    }
  }
  if (calls.length === 0) return null;
  const avgContext = context / calls.length;
  const total = [...sumBy(calls, prices, () => 'all').values()][0] ?? emptyTotals();
  return {
    sessions,
    calls: calls.length,
    tokens: total.input + total.cacheWrite + total.cacheRead + total.output,
    cost: unpriced(calls, prices).length === 0 ? total.cost : null,
    avgContext,
    peakContext: peak,
    health: healthOf(avgContext),
  };
}

const kilo = (n: number) => `${String(Math.round(n / 1000))}K`;

/** The one line on the issue. Numbers only: nothing from the transcripts' text leaves this module. */
export function renderTaskLine(u: TaskUsage): string {
  const cost = u.cost === null ? '' : `, about ${money(u.cost)}`;
  return [
    `Tokens so far: ${mtok(u.tokens)} in ${String(u.calls)} calls${cost}.`,
    `Context health: **${u.health}**, average ${kilo(u.avgContext)} per call, peak ${kilo(u.peakContext)}`,
    `(green under ${kilo(RULES.healthAmber)}, red from ${kilo(RULES.healthRed)}; informational, not a gate).`,
  ].join(' ');
}

/** The line for an issue's comment, or null when there is nothing to say or anything goes wrong: shipping never waits on it. */
export function taskNote(
  issue: number,
  root = PROJECTS_DIR,
  pricesFile = PRICES_FILE,
): string | null {
  try {
    const u = taskUsage(issue, loadPrices(pricesFile), root);
    return u === null ? null : renderTaskLine(u);
  } catch {
    return null;
  }
}

const REVIEW_TITLE = 'Token review';

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

/** Adds the report as a comment on the open `token-review` issue, creating the issue (and its label) the first time. */
export function post(body: string): string {
  const found = JSON.parse(
    gh([
      'issue',
      'list',
      '--label',
      'token-review',
      '--state',
      'open',
      '--json',
      'number',
      '--limit',
      '1',
    ]),
  ) as { number: number }[];
  let number = found[0]?.number;
  if (number === undefined) {
    gh([
      'label',
      'create',
      'token-review',
      '--color',
      '1D76DB',
      '--description',
      'Token cost log and savings proposals (Zeus decides)',
      '--force',
    ]);
    const url = gh([
      'issue',
      'create',
      '--title',
      REVIEW_TITLE,
      '--label',
      'token-review',
      '--body',
      'One comment per run: the token cost and the proposals. Zeus decides each proposal on the record.',
    ]).trim();
    number = Number(url.split('/').pop());
  }
  gh(['issue', 'comment', String(number), '--body-file', '-'], body);
  return `issue #${String(number)}`;
}

function main(argv: string[]): number {
  const i = argv.indexOf('--since');
  const today = new Date().toISOString().slice(0, 10);
  const since =
    i >= 0 ? (argv[i + 1] ?? '') : new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('--since needs a date: YYYY-MM-DD');
    return 2;
  }
  const prices = loadPrices();
  const { calls, sessions } = collect(since);
  const all = propose(calls, sessions, prices);
  const decisions = existsSync(DECISIONS_FILE)
    ? parseDecisions(readFileSync(DECISIONS_FILE, 'utf8'))
    : [];
  const proposals = openProposals(all, decisions, today);
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          since,
          today,
          proposals,
          totals: Object.fromEntries(sumBy(calls, prices, (c) => c.role)),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const body = renderReport({
    since,
    today,
    calls,
    prices,
    proposals,
    suppressed: all.length - proposals.length,
  });
  console.log(body);
  if (argv.includes('--post')) console.log(`\nPosted to ${post(body)}.`);
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
