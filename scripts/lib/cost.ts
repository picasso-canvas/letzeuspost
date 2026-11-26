// The cost of every builder and reviewer run, in one append-only log (~/.letzeuspost/costs.jsonl, #448). Each line is
// the final `result` event of a `claude -p` run: its cost, tokens, turns and duration. Nothing the merge gate reads
// is changed; `node scripts/cost.ts` sums the log per stage.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../merge-gate/reviews.ts';

export const COST_STAGES = ['builder', 'argus', 'cerberus', 'iris'] as const;
export type CostStage = (typeof COST_STAGES)[number];

export interface Usage {
  /** `total_cost_usd` of the run; null when Claude Code didn't report one. */
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  durationMs: number;
}

export interface CostEntry {
  at: string;
  stage: CostStage;
  /** The model asked for, or null when the agent file chooses it. */
  model: string | null;
  /** A reviewer run names its PR, a builder run its task issue. */
  pr?: number;
  issue?: number;
  usage: Usage;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** The usage in a `result` event of `claude -p`; null for anything else. */
export function usageOf(event: unknown): Usage | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as {
    type?: unknown;
    total_cost_usd?: unknown;
    num_turns?: unknown;
    duration_ms?: unknown;
    usage?: Record<string, unknown> | null;
  };
  if (e.type !== 'result') return null;
  const u = e.usage ?? {};
  return {
    costUsd:
      typeof e.total_cost_usd === 'number' &&
      Number.isFinite(e.total_cost_usd) &&
      e.total_cost_usd >= 0
        ? e.total_cost_usd
        : null,
    inputTokens: count(u.input_tokens),
    outputTokens: count(u.output_tokens),
    cacheReadTokens: count(u.cache_read_input_tokens),
    cacheCreationTokens: count(u.cache_creation_input_tokens),
    turns: count(e.num_turns),
    durationMs: count(e.duration_ms),
  };
}

/** The usage of `claude -p --output-format json` output (a reviewer run); null when it isn't a result. */
export function usageFromJson(json: string): Usage | null {
  try {
    return usageOf(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The usage of the last `result` event in a `stream-json` log (a builder run); null when there is none. */
export function usageFromStream(log: string): Usage | null {
  let usage: Usage | null = null;
  for (const line of log.split('\n')) {
    try {
      usage = usageOf(JSON.parse(line)) ?? usage;
    } catch {
      // not an event line (the stream's tail can start mid-line)
    }
  }
  return usage;
}

/** Appends one run's cost. A cost that can't be written is reported and dropped: it never fails a review or a build. */
export function logCost(entry: CostEntry, stateDir = STATE_DIR): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    appendFileSync(join(stateDir, 'costs.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error(`Cost not logged: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isCostEntry(value: unknown): value is CostEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as { at?: unknown; stage?: unknown; usage?: unknown };
  return (
    typeof e.at === 'string' &&
    (COST_STAGES as readonly unknown[]).includes(e.stage) &&
    typeof e.usage === 'object' &&
    e.usage !== null
  );
}

/** The log's entries, oldest first; none when there is no log, and lines that are no entry are skipped. */
export function readCosts(stateDir = STATE_DIR): CostEntry[] {
  let text: string;
  try {
    text = readFileSync(join(stateDir, 'costs.jsonl'), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try {
      const entry: unknown = JSON.parse(line);
      return isCostEntry(entry) ? [entry] : [];
    } catch {
      return [];
    }
  });
}

export interface CostRow {
  stage: CostStage | 'total';
  runs: number;
  costUsd: number;
  /** Runs with no reported cost: the dollar figure is a floor when this isn't 0. */
  noCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

function emptyRow(stage: CostRow['stage']): CostRow {
  return {
    stage,
    runs: 0,
    costUsd: 0,
    noCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

function add(row: CostRow, usage: Usage): void {
  row.runs++;
  if (usage.costUsd === null) row.noCost++;
  else row.costUsd += usage.costUsd;
  row.inputTokens += count(usage.inputTokens);
  row.outputTokens += count(usage.outputTokens);
  row.cacheReadTokens += count(usage.cacheReadTokens);
  row.cacheCreationTokens += count(usage.cacheCreationTokens);
}

/** One row per stage that has runs (in stage order), then the total; `since` (an ISO date) drops older entries. */
export function summariseCosts(entries: readonly CostEntry[], since?: string): CostRow[] {
  const rows = new Map<CostStage, CostRow>();
  const total = emptyRow('total');
  for (const entry of entries) {
    if (since !== undefined && entry.at < since) continue;
    const row = rows.get(entry.stage) ?? emptyRow(entry.stage);
    rows.set(entry.stage, row);
    add(row, entry.usage);
    add(total, entry.usage);
  }
  return [...COST_STAGES.flatMap((stage) => rows.get(stage) ?? []), total];
}

function thousands(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${String(Math.round(n / 1000))}k`
      : String(n);
}

/** One line per row: runs, dollars, and the tokens (input / output / cache read / cache write). */
export function formatCosts(rows: readonly CostRow[]): string {
  return rows
    .map((r) => {
      const dollars = `$${r.costUsd.toFixed(2)}${r.noCost > 0 ? `+ (${String(r.noCost)} run${r.noCost === 1 ? '' : 's'} unpriced)` : ''}`;
      const avg =
        r.runs - r.noCost > 0 ? ` avg $${(r.costUsd / (r.runs - r.noCost)).toFixed(2)}` : '';
      return `${r.stage.padEnd(8)} ${String(r.runs).padStart(4)} runs  ${dollars}${avg}  tokens in ${thousands(r.inputTokens)} out ${thousands(r.outputTokens)} cache-read ${thousands(r.cacheReadTokens)} cache-write ${thousands(r.cacheCreationTokens)}`;
    })
    .join('\n');
}
