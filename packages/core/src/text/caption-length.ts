import { assertNever } from '../assert-never.ts';
import { graphemes } from './graphemes.ts';

export const NETWORKS = [
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'tiktok',
  'pinterest',
] as const;

export type Network = (typeof NETWORKS)[number];

/** What X counts a link as, however long it is (§07). */
const X_URL_WEIGHT = 23;

// What X turns into a 23-weight link: http:// or https:// and everything to the next space, or a bare domain
// (example.com, site.co.uk/path): dot-separated labels (any script, so বাংলা.com too) ending in a letters-only label
// of 2+ characters, then an optional path. The rule is that a counter may count more than X, never less: X knows
// the real top-level domains and we don't, so anything shaped like a domain counts as a link, and only what can't be
// one (v1.2, e.g., 3.5, U.S.A) stays text.
//
// The pattern must run in linear time, because it runs on whatever caption a user pastes (up to 63,206 characters).
// So a link starts only at a word start (nothing from WORD_CHAR just before it), and a bare domain looks at a bounded
// stretch: a label is 1–63 characters, and a run of 255 or more domain characters (letters, digits, - and .) is
// refused before any label is tried, so a domain is at most 253 characters, with room for the period that ends a
// sentence. Each start then costs at most about 255 steps. A link's body also stops before the next http(s)://, so
// two links with only punctuation between them are two links.
const WORD_CHAR = '\\p{L}\\p{M}\\p{N}-';
const LABEL = `[${WORD_CHAR}]{1,63}`;
const SCHEME = 'https?://';
const BODY = `(?:(?!${SCHEME})\\S)*`;
const LINK_PATTERN = new RegExp(
  `(?<![${WORD_CHAR}])(?:${SCHEME}${BODY}|(?![.${WORD_CHAR}]{255})(?:${LABEL}\\.)+[\\p{L}\\p{M}]{2,63}(?![${WORD_CHAR}])(?:[/?#]${BODY})?)`,
  'giu',
);

// Punctuation after a link isn't part of it, the Bangla danda (।) included. A closing bracket is, when it closes one
// opened inside the link (en.wikipedia.org/wiki/Foo_(bar)); an extra one is the sentence's.
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '।']);
const OPENER_OF: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const BRACKET_CHARS = new Set(['(', ')', '[', ']', '{', '}']);

/** Where a link candidate ends, after its trailing punctuation and unmatched closing brackets: one pass counts the
 * brackets, then the end moves back, updating the counts as it drops characters, so it is linear in the length. */
function linkEnd(candidate: string): number {
  const counts = new Map<string, number>();
  for (const char of candidate) {
    if (BRACKET_CHARS.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let end = candidate.length;
  while (end > 0) {
    const last = candidate.charAt(end - 1);
    const opener = OPENER_OF[last];
    if (opener !== undefined) {
      const closers = counts.get(last) ?? 0;
      if (closers <= (counts.get(opener) ?? 0)) break;
      counts.set(last, closers - 1);
    } else if (!TRAILING_PUNCTUATION.has(last)) {
      break;
    }
    end -= 1;
  }
  return end;
}

// An emoji grapheme: an emoji shown as a picture by default, a pictograph forced to picture style (U+FE0F), a flag
// (regional indicators) or a keycap (U+20E3). Digits and symbols like © stay plain characters.
const EMOJI_PATTERN = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}|⃣/u;

const utf8 = new TextEncoder();

function isEmoji(grapheme: string): boolean {
  return EMOJI_PATTERN.test(grapheme);
}

/** X's own weights per code point: Latin, Bangla and most scripts 1; CJK and everything above U+10FF 2. */
function xCodePointWeight(codePoint: number): 1 | 2 {
  const light =
    codePoint <= 4351 ||
    (codePoint >= 8192 && codePoint <= 8205) ||
    (codePoint >= 8208 && codePoint <= 8223) ||
    (codePoint >= 8242 && codePoint <= 8247);
  return light ? 1 : 2;
}

function xTextLength(text: string): number {
  let total = 0;
  for (const grapheme of graphemes(text)) {
    if (isEmoji(grapheme)) {
      total += 2;
      continue;
    }
    for (const char of grapheme) {
      total += xCodePointWeight(char.codePointAt(0) ?? 0);
    }
  }
  return total;
}

function xLength(text: string): number {
  let total = 0;
  let end = 0;
  for (const candidate of text.matchAll(LINK_PATTERN)) {
    total += xTextLength(text.slice(end, candidate.index)) + X_URL_WEIGHT;
    end = candidate.index + linkEnd(candidate[0]);
  }
  return total + xTextLength(text.slice(end));
}

function threadsLength(text: string): number {
  let total = 0;
  for (const grapheme of graphemes(text)) {
    total += isEmoji(grapheme) ? utf8.encode(grapheme).length : 1;
  }
  return total;
}

/**
 * How many characters `text` costs on `network`, counted the way that network counts (§07): X by weight, TikTok in
 * UTF-16 units, Threads with emoji as their UTF-8 byte length, and the others in graphemes.
 */
export function captionLength(network: Network, text: string): number {
  switch (network) {
    case 'x':
      return xLength(text);
    case 'tiktok':
      return text.length;
    case 'threads':
      return threadsLength(text);
    case 'instagram':
    case 'facebook':
    case 'linkedin':
    case 'pinterest':
      return graphemes(text).length;
    default:
      return assertNever(network);
  }
}

/** True when `text` is within `limit` on `network`; the limits live in `config/networks.ts` (§07). */
export function fitsCaption(network: Network, text: string, limit: number): boolean {
  return captionLength(network, text) <= limit;
}
