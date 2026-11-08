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

// A link starts with http:// or https:// and runs to the next space. Closing punctuation at the end, including the
// Bangla danda (।), is not part of it. Links without a scheme (example.com) are counted as plain text.
const URL_PATTERN = /https?:\/\/\S*[^\s.,;:!?)\]}'"।]/giu;

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
  for (const link of text.matchAll(URL_PATTERN)) {
    total += xTextLength(text.slice(end, link.index)) + X_URL_WEIGHT;
    end = link.index + link[0].length;
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
