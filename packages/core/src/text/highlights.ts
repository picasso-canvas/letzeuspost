import type { TextIssue } from './issues.ts';

export type HighlightSegment = { text: string; highlight: boolean };

export type ParsedHighlights = {
  /** The text in order, cut at the markers. Plain text only: nothing here is HTML, and the renderer escapes it. */
  segments: HighlightSegment[];
  /** Index ranges point into the text that was parsed. */
  issues: TextIssue[];
};

// A letter, a mark (a Bangla vowel sign, hasanta or anusvara), a digit, an underscore or a joiner is part of a word:
// a marker touching one from the outside would cut the word, and a cut Bangla word shapes wrongly (§08).
const JOINERS = String.fromCodePoint(0x200c, 0x200d);
const WORD_CHAR = new RegExp(`^[\\p{L}\\p{M}\\p{N}_${JOINERS}]$`, 'u');
const SPACE = /^\s$/u;

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

/** True for a character a highlight can start or end on: not a space, not another marker. */
function isContent(char: string | undefined): boolean {
  return char !== undefined && char !== '*' && !SPACE.test(char);
}

/**
 * Reads `*highlight*` markers (§07). A marker opens a highlight when no word character is before it and a
 * non-space is after it, and closes one when no word character is after it and a non-space is before it. A marker
 * that touches a word on both sides (`ab*cd`), one that closes in the middle of a word (`*ab*cd`) and one that has
 * no partner are errors; a rejected marker stays in the text as a plain `*`, so nothing is dropped silently.
 */
export function parseHighlights(text: string): ParsedHighlights {
  const chars = Array.from(text);
  const offsets: number[] = []; // the UTF-16 index where each character starts
  let position = 0;
  for (const char of chars) {
    offsets.push(position);
    position += char.length;
  }
  offsets.push(position);

  const issues: TextIssue[] = [];
  const pairs: { open: number; close: number }[] = [];
  const reject = (at: number, insideWord: boolean) => {
    issues.push({
      code: insideWord ? 'highlight-inside-word' : 'highlight-unmatched',
      severity: 'error',
      start: offsets[at] ?? 0,
      end: offsets[at + 1] ?? 0,
    });
  };

  let open: number | undefined;
  for (const [at, char] of chars.entries()) {
    if (char !== '*') continue;
    const before = chars[at - 1];
    const after = chars[at + 1];
    const insideWord = isWord(before) && isWord(after);
    if (open === undefined) {
      if (!isWord(before) && isContent(after)) open = at;
      else reject(at, insideWord);
    } else if (!isWord(after) && isContent(before)) {
      pairs.push({ open, close: at });
      open = undefined;
    } else {
      reject(at, insideWord);
    }
  }
  if (open !== undefined) reject(open, false);

  const segments: HighlightSegment[] = [];
  const push = (from: number, to: number, highlight: boolean) => {
    const slice = text.slice(offsets[from], offsets[to]);
    if (slice !== '') segments.push({ text: slice, highlight });
  };
  let cursor = 0;
  for (const pair of pairs) {
    push(cursor, pair.open, false);
    push(pair.open + 1, pair.close, true);
    cursor = pair.close + 1;
  }
  push(cursor, chars.length, false);

  return { segments, issues: issues.sort((a, b) => a.start - b.start) };
}
