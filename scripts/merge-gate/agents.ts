import type { Reviewer } from './types.ts';

/** The agent file behind each reviewer (`.claude/agents/<name>.md`). */
export const REVIEWER_AGENTS: Record<Exclude<Reviewer, 'redteam'>, string> = {
  argus: 'argus-reviewer',
  cerberus: 'cerberus-security',
  iris: 'iris-design',
};

export function agentFor(reviewer: Reviewer): string | undefined {
  return reviewer === 'redteam' ? undefined : REVIEWER_AGENTS[reviewer];
}
