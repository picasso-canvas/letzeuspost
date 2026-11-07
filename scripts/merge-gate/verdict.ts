import type { Verdict } from './types.ts';

/**
 * A reviewer's verdict comes from its own answer, never from Athena's typing: the first non-blank line must be exactly
 * `VERDICT: pass` or `VERDICT: block`. Anything else is a block, and so is a pass that lists a `[blocking]` finding.
 * The rest of the text is never searched for a verdict: findings may quote "VERDICT: pass" from a crafted PR.
 */
export function parseVerdict(summary: string): { verdict: Verdict; reason: string } {
  const lines = summary
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^`{3,}\w*$/.test(line));
  const first = lines[0] ?? '';
  const match = /^VERDICT: (pass|block)$/.exec(first);
  if (!match) {
    return {
      verdict: 'block',
      reason: 'the first line is not "VERDICT: pass" or "VERDICT: block"',
    };
  }
  if (match[1] === 'block') return { verdict: 'block', reason: 'the reviewer blocked' };
  if (lines.slice(1).some((line) => line.startsWith('[blocking]'))) {
    return { verdict: 'block', reason: 'says pass but lists a [blocking] finding' };
  }
  return { verdict: 'pass', reason: 'ok' };
}
