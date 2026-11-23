import type { FontLanguage } from './manifest.ts';
import { mappedCodePoints } from './woff2.ts';

// The characters a font must draw to be set for a language (§08: "confirms it covers the language it's set for").

const range = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i);

/**
 * Modern Bangla: the signs ঁ ং ঃ, the vowels, the consonants, nukta, the vowel signs, hasant, khanda ta, the au
 * length mark, ড় ঢ় য়, the digits, the taka sign, and the danda । ॥. The archaic ঌ ৠ ৡ are left out.
 */
const BENGALI = [
  ...range(0x0981, 0x0983),
  ...range(0x0985, 0x098b),
  0x098f,
  0x0990,
  ...range(0x0993, 0x09a8),
  ...range(0x09aa, 0x09b0),
  0x09b2,
  ...range(0x09b6, 0x09b9),
  0x09bc,
  ...range(0x09be, 0x09c3),
  0x09c7,
  0x09c8,
  ...range(0x09cb, 0x09ce),
  0x09d7,
  0x09dc,
  0x09dd,
  0x09df,
  ...range(0x09e6, 0x09ef),
  0x09f3,
  0x0964,
  0x0965,
];

/** English: the Latin letters and the digits. */
const LATIN = [...range(0x41, 0x5a), ...range(0x61, 0x7a), ...range(0x30, 0x39)];

const REQUIRED_CODE_POINTS: Readonly<Record<FontLanguage, readonly number[]>> = {
  en: LATIN,
  bn: BENGALI,
};

/** The characters of `language` that none of `files` (one weight's WOFF2 files, all subsets) draws. */
export function missingLetters(files: readonly Uint8Array[], language: FontLanguage): string[] {
  const mapped = new Set(files.flatMap((file) => [...mappedCodePoints(file)]));
  return REQUIRED_CODE_POINTS[language]
    .filter((code) => !mapped.has(code))
    .map((code) => String.fromCodePoint(code));
}
