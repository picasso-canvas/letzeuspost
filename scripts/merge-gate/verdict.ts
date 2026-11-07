import type { Verdict } from './types.ts';

/**
 * A reviewer's verdict comes from its own answer, never from Athena's typing: the first non-blank line must be exactly
 * `VERDICT: pass` or `VERDICT: block`. Anything else is a block, and so is a pass that lists a `[blocking]` finding or
 * a later `VERDICT: block` line.
 * A "VERDICT: pass" lower down never counts (findings may quote one from a crafted PR); a "VERDICT: block" does.
 */
export function parseVerdict(summary: string): { verdict: Verdict; reason: string } {
  const lines = summary
    .replace(/\r\n/g, '\n')
    .split(/\r\n?|\n/)
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
  if (lines.slice(1).some((line) => /^\W*VERDICT:\s*block\b/i.test(line))) {
    return { verdict: 'block', reason: 'says pass, then VERDICT: block' };
  }
  // A blocking finding behind any leading markup: list markers, task boxes, emphasis, quotes, headings, HTML tags.
  if (lines.slice(1).some((line) => /^\[\s*blocking\s*\]/i.test(stripLeadingMarkup(line)))) {
    return { verdict: 'block', reason: 'says pass but lists a [blocking] finding' };
  }
  return { verdict: 'pass', reason: 'ok' };
}

/**
 * Removes whatever can stand before a finding's `[blocking]` tag: anything that isn't a letter, digit or `[` (table
 * bars, emoji, dashes, quotes, zero-width characters), task boxes, HTML tags, numbered and lettered list markers.
 */
function stripLeadingMarkup(line: string): string {
  // Order matters: tags, boxes and list markers before the catch-all, which would eat their first character.
  const noise =
    /^(?:<[^<>[\]]*>|\[[ xX]\](?=\s|\[)|\d+[.)]|(?:[a-z]|[ivxlc]+)[.)](?=\s)|[^\p{L}\p{N}[<]+|<)/iu;
  let rest = line;
  for (let match = noise.exec(rest); match && match[0] !== ''; match = noise.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  return rest;
}
