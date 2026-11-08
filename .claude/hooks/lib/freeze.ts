// Zeus's freeze switch (§20). Dispatch copies the repo variable AGENTS_PAUSED into ~/.letzeuspost/paused every
// minute as {"paused": false, "at": "<ISO UTC>", "source": "AGENTS_PAUSED"}, because builders can't reach GitHub.
//
// A builder is frozen when the flag says paused, can't be read, or is older than 3 minutes: a dead refresher fails
// closed. Anyone else (Athena in a session started in this repo) has no refresher, so only an explicit
// `"paused": true` stops them; a missing or old flag doesn't.

export const STALE_AFTER_MS = 3 * 60 * 1000;
/** A flag dated more than this far in the future means a clock or a writer we don't trust. */
const FUTURE_SLACK_MS = 60 * 1000;

export type Role = 'builder' | 'other';

export interface FreezeDecision {
  frozen: boolean;
  reason: string;
}

interface Flag {
  paused: boolean;
  at: number;
}

function parseFlag(text: string | null): Flag | string {
  if (text === null) return 'the freeze flag ~/.letzeuspost/paused is missing';
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'the freeze flag is not valid JSON';
  }
  if (typeof value !== 'object' || value === null) return 'the freeze flag is not a JSON object';
  const { paused, at } = value as Record<string, unknown>;
  if (typeof paused !== 'boolean') return 'the freeze flag has no true/false "paused"';
  const time = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(time)) return 'the freeze flag has no readable "at" time';
  return { paused, at: time };
}

export function decideFreeze(flagText: string | null, now: number, role: Role): FreezeDecision {
  const flag = parseFlag(flagText);
  if (role !== 'builder') {
    return typeof flag !== 'string' && flag.paused
      ? {
          frozen: true,
          reason: 'Zeus has paused all agents (AGENTS_PAUSED is true). Stop and wait.',
        }
      : { frozen: false, reason: '' };
  }
  if (typeof flag === 'string')
    return { frozen: true, reason: `${flag}, so agents count as paused. Stop.` };
  if (flag.paused)
    return { frozen: true, reason: 'Zeus has paused all agents (AGENTS_PAUSED is true). Stop.' };
  const age = now - flag.at;
  if (age > STALE_AFTER_MS) {
    return {
      frozen: true,
      reason: `the freeze flag is ${String(Math.round(age / 1000))} s old (over 3 minutes), so agents count as paused. Stop.`,
    };
  }
  if (age < -FUTURE_SLACK_MS) {
    return {
      frozen: true,
      reason: 'the freeze flag is dated in the future, so agents count as paused. Stop.',
    };
  }
  return { frozen: false, reason: '' };
}
