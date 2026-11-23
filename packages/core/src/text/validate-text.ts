import { isEmoji } from './caption-length.ts';
import { graphemes } from './graphemes.ts';
import type { TextIssue } from './issues.ts';

export type ValidateTextOptions = { lang: 'en' | 'bn'; surface: 'slide' | 'caption' };

export type ValidateTextResult = {
  /** The text with the invisible characters removed (the joiner and non-joiner stay). */
  text: string;
  /** Sorted by position; every index range points into the text that was passed in, not into `text`. */
  issues: TextIssue[];
};

// Removed and reported: soft hyphen, combining grapheme joiner, Arabic letter mark, Mongolian vowel separator,
// zero-width space, the left-to-right and right-to-left marks, the bidi embeddings and overrides (U+202A–202E),
// the word joiner and invisible math operators (U+2060–2064), the bidi isolates (U+2066–2069) and the BOM.
// The zero-width joiner and non-joiner (U+200D, U+200C) are not in the list: Bangla needs them (র‍্যা, §08).
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const ZWNJ = 0x200c;
const ZWJ = 0x200d;

function isInvisible(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to);
}

type Kind = 'letter' | 'nukta' | 'hasanta' | 'vowel' | 'candra' | 'anusvara' | 'joiner' | 'other';

const E_SIGN = 0x09c7;
const AA_SIGN = 0x09be;
const AU_LENGTH_MARK = 0x09d7;

// The Bengali block (U+0980–09FF), as the shaper sees it: what can carry a sign, and the signs themselves.
function kindOf(code: number): Kind {
  if (code === ZWJ || code === ZWNJ) return 'joiner';
  if (code === 0x09bc) return 'nukta';
  if (code === 0x09cd) return 'hasanta';
  if (code === 0x0981) return 'candra';
  if (code === 0x0982 || code === 0x0983) return 'anusvara';
  if (
    (code >= 0x09be && code <= 0x09c4) ||
    code === 0x09c7 ||
    code === 0x09c8 ||
    code === 0x09cb ||
    code === 0x09cc ||
    code === 0x09d7 ||
    code === 0x09e2 ||
    code === 0x09e3
  ) {
    return 'vowel';
  }
  const letter =
    (code >= 0x0985 && code <= 0x098c) ||
    code === 0x098f ||
    code === 0x0990 ||
    (code >= 0x0993 && code <= 0x09a8) ||
    (code >= 0x09aa && code <= 0x09b0) ||
    code === 0x09b2 ||
    (code >= 0x09b6 && code <= 0x09b9) ||
    code === 0x09bd ||
    code === 0x09ce ||
    code === 0x09dc ||
    code === 0x09dd ||
    (code >= 0x09df && code <= 0x09e1) ||
    code === 0x09f0 ||
    code === 0x09f1;
  return letter ? 'letter' : 'other';
}

// What the text before a sign allows: nothing, a letter (or a letter with a nukta), a vowel sign, a candrabindu, an
// anusvara or visarga, or a hasanta (which wants the next letter, to make a conjunct).
type State = 'none' | 'letter' | 'vowel' | 'candra' | 'anusvara' | 'hasanta';

// Which states each sign may follow. A nukta keeps the state of its letter; a candrabindu may come before the vowel
// sign (চঁা) as well as after it (চাঁ).
const SIGN_FOLLOWS: Record<
  'nukta' | 'hasanta' | 'vowel' | 'candra' | 'anusvara',
  readonly State[]
> = {
  nukta: ['letter'],
  hasanta: ['letter'],
  vowel: ['letter', 'candra'],
  candra: ['letter', 'vowel'],
  anusvara: ['letter', 'vowel'],
};

/** The Bangla signs that have no letter to stand on: they would print as a dotted circle (◌). Indices are in
 * `text`. A joiner changes nothing: the sign still needs the letter before it. */
function orphanSigns(text: string): TextIssue[] {
  const issues: TextIssue[] = [];
  let state = 'none' as State;
  let previous = 0; // the last code that was not a joiner
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const kind = kindOf(code);
    if (kind === 'joiner') continue;
    if (kind === 'letter' || kind === 'other') {
      state = kind === 'letter' ? 'letter' : 'none';
    } else {
      // ো and ৌ may be written as ে followed by া or the length mark.
      const splitVowel =
        kind === 'vowel' &&
        state === 'vowel' &&
        previous === E_SIGN &&
        (code === AA_SIGN || code === AU_LENGTH_MARK);
      if (splitVowel || SIGN_FOLLOWS[kind].includes(state)) {
        state = kind === 'nukta' ? 'letter' : kind;
      } else {
        issues.push({
          code: kind === 'hasanta' ? 'orphan-hasanta' : 'orphan-vowel-sign',
          severity: 'error',
          start: index,
          end: index + 1,
        });
        state = 'none';
      }
    }
    previous = code;
  }
  return issues;
}

function emojiRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  for (const grapheme of graphemes(text)) {
    const end = offset + grapheme.length;
    if (isEmoji(grapheme)) {
      const last = ranges.at(-1);
      if (last?.end === offset) last.end = end;
      else ranges.push({ start: offset, end });
    }
    offset = end;
  }
  return ranges;
}

/**
 * The checks a text passes before it is rendered or counted (§08 › Bangla, shared with §09's output checks).
 *
 * - Invisible characters other than the zero-width joiner and non-joiner are removed and reported (warning).
 * - A Bangla vowel sign, nukta, candrabindu, anusvara, visarga or hasanta with no letter to stand on is an error:
 *   it would print as a dotted circle (◌). Checked in any language, because the glyph is wrong in any language.
 * - Latin digits in `bn` text are a warning (§07: Bangla digits).
 * - An emoji on a `slide` is an error; a `caption` may have them.
 *
 * The signs are judged on the cleaned text, so a zero-width space between a letter and its sign does not make the
 * sign an orphan. Every issue's range points into the original `text`.
 */
export function validateText(text: string, options: ValidateTextOptions): ValidateTextResult {
  const issues: TextIssue[] = [];

  // Remove the invisible characters, remembering where each kept UTF-16 unit came from.
  let cleaned = '';
  const origin: number[] = [];
  let runStart = -1;
  let index = 0;
  for (const char of text) {
    if (isInvisible(char)) {
      if (runStart < 0) runStart = index;
    } else {
      if (runStart >= 0) {
        issues.push({
          code: 'invisible-character',
          severity: 'warning',
          start: runStart,
          end: index,
        });
        runStart = -1;
      }
      for (let unit = 0; unit < char.length; unit += 1) origin.push(index + unit);
      cleaned += char;
    }
    index += char.length;
  }
  if (runStart >= 0) {
    issues.push({ code: 'invisible-character', severity: 'warning', start: runStart, end: index });
  }

  // A range in `cleaned` becomes a range in `text`.
  const inOriginal = (start: number, end: number) => ({
    start: origin[start] ?? text.length,
    end: (origin[end - 1] ?? text.length - 1) + 1,
  });

  for (const orphan of orphanSigns(cleaned)) {
    issues.push({ ...orphan, ...inOriginal(orphan.start, orphan.end) });
  }
  if (options.lang === 'bn') {
    for (const digits of cleaned.matchAll(/[0-9]+/g)) {
      issues.push({
        code: 'latin-digit-in-bangla',
        severity: 'warning',
        ...inOriginal(digits.index, digits.index + digits[0].length),
      });
    }
  }
  if (options.surface === 'slide') {
    for (const range of emojiRanges(cleaned)) {
      issues.push({
        code: 'emoji-on-slide',
        severity: 'error',
        ...inOriginal(range.start, range.end),
      });
    }
  }

  return { text: cleaned, issues: issues.sort((a, b) => a.start - b.start) };
}
