import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REVIEWERS, type ReviewRecord } from './types.ts';

/** Athena's local record: outside every builder clone and the builder sandbox. */
export const STATE_DIR = join(homedir(), '.letzeuspost');

const SHA = /^[0-9a-f]{40}$/;
const FILE = /^(argus|cerberus|iris|redteam)-\d+-[0-9a-f]{8}\.json$/;

function reviewDir(stateDir: string, pr: number, sha: string): string {
  if (!Number.isInteger(pr) || pr <= 0) throw new Error(`bad PR number: ${String(pr)}`);
  if (!SHA.test(sha)) throw new Error(`bad commit SHA: ${sha}`);
  return join(stateDir, 'reviews', `pr-${String(pr)}`, sha);
}

/** Append-only: every verdict gets its own new file, so a later pass can never hide an earlier block. */
export function writeReview(record: ReviewRecord, stateDir = STATE_DIR): string {
  const dir = reviewDir(stateDir, record.pr, record.sha);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nonce = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  const file = join(dir, `${record.reviewer}-${String(Date.now())}-${nonce}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}

function isRecord(value: unknown): value is ReviewRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.pr === 'number' &&
    typeof r.sha === 'string' &&
    typeof r.reviewer === 'string' &&
    (REVIEWERS as readonly string[]).includes(r.reviewer) &&
    (r.verdict === 'pass' || r.verdict === 'block') &&
    typeof r.bodyHash === 'string'
  );
}

/** The records for one PR at one commit. Anything that doesn't parse or doesn't match counts as a block. */
export function readReviews(pr: number, sha: string, stateDir = STATE_DIR): ReviewRecord[] {
  const dir = reviewDir(stateDir, pr, sha);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.map((name) => {
    const reviewer = FILE.exec(name)?.[1];
    try {
      const parsed: unknown = reviewer ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null;
      if (
        isRecord(parsed) &&
        parsed.reviewer === reviewer &&
        parsed.pr === pr &&
        parsed.sha === sha
      ) {
        return parsed;
      }
    } catch {
      // fall through: unreadable records block
    }
    return {
      pr,
      sha,
      reviewer: 'argus',
      verdict: 'block',
      bodyHash: '',
      summary: `unreadable or unexpected record ${name}`,
      at: '',
    } satisfies ReviewRecord;
  });
}

export function logMerge(entry: Record<string, unknown>, stateDir = STATE_DIR): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  appendFileSync(join(stateDir, 'merges.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}
