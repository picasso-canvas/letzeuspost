// Shared plumbing for the hook entry points: input, role, Athena's state folder, safe reads, the guardrail log.
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redact } from './content.ts';
import type { Role } from './freeze.ts';

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  stop_hook_active?: boolean;
  agent_type?: string;
}

export function readInput(): HookInput {
  const text = readFileSync(0, 'utf8');
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null)
    throw new Error('hook input is not a JSON object');
  return value;
}

/**
 * A builder when the builder settings' hook command says so (`--builder`, in main's file) or dispatch set
 * LZP_ROLE=builder; either one is enough, so a lost variable never turns a builder's hook into anyone else's.
 */
export function role(): Role {
  return process.argv.includes('--builder') || process.env.LZP_ROLE === 'builder'
    ? 'builder'
    : 'other';
}

export function projectDir(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
}

/** ~/.letzeuspost: outside every builder clone and denied to the builder sandbox; hooks run unsandboxed. */
export function stateDir(): string {
  return join(process.env.HOME ?? homedir(), '.letzeuspost');
}

/** Athena's own files (state folder, main's checkout): read as they are. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * A file a builder could have planted: opened without following a symlink, read only when it is a regular file
 * (not a FIFO or device) with a single link, and at most `limit` bytes of it. Otherwise null.
 */
export function readPlanted(path: string, limit = 2_000_000): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink > 1) return null;
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export interface Hit {
  hook: string;
  rule: string;
  reason: string;
  tool?: string;
  detail?: string;
}

/** One line per block in ~/.letzeuspost/logs/guardrail-hits.jsonl, for the weekly report. Never throws. */
export function logHit(input: HookInput, hit: Hit): void {
  const entry = {
    at: new Date().toISOString(),
    role: role(),
    session: input.session_id ?? null,
    agent: input.agent_type ?? null,
    project: projectDir(input),
    ...hit,
    detail: hit.detail === undefined ? undefined : redact(hit.detail).slice(0, 300),
  };
  try {
    const dir = join(stateDir(), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'guardrail-hits.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // The block still holds without its log line.
  }
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}

export function denyTool(reason: string): void {
  printJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `LetZeusPost guardrail: ${reason}`,
    },
  });
}
