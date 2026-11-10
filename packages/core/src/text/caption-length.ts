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
// Text written without spaces (Chinese, Japanese, Thai) has no word start before a link, so a link may also start
// where the characters change from ASCII to other scripts or back: 请访问example.com了解更多 is 请访问, a link and
// 了解更多. For that, a label and the last label are each all ASCII or all non-ASCII, so a domain stops where its
// ASCII stops. Splitting a mixed-script domain (bücher.de) this way counts the text before the split besides the
// link, which is more than X, never less.
//
// The pattern must run in linear time, because it runs on whatever caption a user pastes (up to 63,206 characters).
// So a link starts only at a word start or a change of script, and a bare domain looks at a bounded stretch: a label
// is 1–63 characters, and a domain is at most 253, which two fixed-length checks before any label is tried enforce:
// a run of 255 or more domain characters (letters, digits, - and .) is refused, and so is a run of exactly 254 unless
// it ends in a period (253 and the period that ends a sentence). Each start then costs at most about 510 steps. A
// link's body also stops before the next http(s)://, so two links with only punctuation between them are two links.
const ASCII_WORD = '[A-Za-z0-9\\-]';
const OTHER_WORD = '[[\\p{L}\\p{M}\\p{N}]--[\\x00-\\x7f]]';
const WORD_CHAR = '\\p{L}\\p{M}\\p{N}\\-';
const DOMAIN_CHAR = `[.${WORD_CHAR}]`;
const LABEL = `(?:${ASCII_WORD}{1,63}|${OTHER_WORD}{1,63})`;
const TLD = `(?:[A-Za-z]{2,63}(?!${ASCII_WORD})|[[\\p{L}\\p{M}]--[\\x00-\\x7f]]{2,63}(?!${OTHER_WORD}))`;
const LINK_START = `(?:(?<![${WORD_CHAR}])|(?<=${ASCII_WORD})(?=${OTHER_WORD})|(?<=${OTHER_WORD})(?=${ASCII_WORD}))`;
const DOMAIN_CAP = `(?!${DOMAIN_CHAR}{255})(?!${DOMAIN_CHAR}{253}[${WORD_CHAR}](?!${DOMAIN_CHAR}))`;
const SCHEME = 'https?://';
const BODY = `(?:(?!${SCHEME})\\S)*`;
const LINK_PATTERN = new RegExp(
  `${LINK_START}(?:${SCHEME}${BODY}|${DOMAIN_CAP}(?:${LABEL}\\.)+${TLD}(?:[\\/?#]${BODY})?)`,
  'gv',
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
 *
 * A caller at a server or job boundary (a route, an action, a job) must refuse text over a fixed cap before counting:
 * the cost grows with the text, and the text is whatever a user sent. The cap itself comes with the first caller.
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
