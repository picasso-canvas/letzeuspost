import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { missingLetters } from './coverage.ts';
import { mappedCodePoints } from './woff2.ts';

const require = createRequire(import.meta.url);
const font = (path: string) => new Uint8Array(readFileSync(require.resolve(path)));
const hindBengali = font('@fontsource/hind-siliguri/files/hind-siliguri-bengali-400-normal.woff2');
const hindLatin = font('@fontsource/hind-siliguri/files/hind-siliguri-latin-400-normal.woff2');
const balooDaBengali = font('@fontsource/baloo-da-2/files/baloo-da-2-bengali-800-normal.woff2');
const nunitoLatin = font('@fontsource/nunito/files/nunito-latin-400-normal.woff2');

describe('mappedCodePoints', () => {
  it("reads a WOFF2 file's character map", () => {
    const latin = mappedCodePoints(nunitoLatin);
    expect(latin.has(0x41)).toBe(true); // A
    expect(latin.has(0x7a)).toBe(true); // z
    expect(latin.has(0x0985)).toBe(false); // অ
    const bengali = mappedCodePoints(hindBengali);
    expect(bengali.has(0x0985)).toBe(true); // অ
    expect(bengali.has(0x09cd)).toBe(true); // ্ (hasant)
  });

  it('refuses bytes that are not a WOFF2 file', () => {
    expect(() => mappedCodePoints(new Uint8Array(64))).toThrow(/not a WOFF2 file/);
    expect(() => mappedCodePoints(new TextEncoder().encode('wOFF and more'))).toThrow(
      /not a WOFF2 file/,
    );
  });

  it('refuses a truncated WOFF2 file instead of reading past its end', () => {
    expect(() => mappedCodePoints(hindBengali.subarray(0, 200))).toThrow(/WOFF2/);
  });
});

describe('missingLetters', () => {
  it('finds every Bengali letter, sign and digit in a Bangla font', () => {
    expect(missingLetters([hindBengali, hindLatin], 'bn')).toEqual([]);
    expect(missingLetters([balooDaBengali], 'bn')).toEqual([]);
  });

  it('refuses a Latin-only font for Bangla, listing the letters it lacks', () => {
    const missing = missingLetters([nunitoLatin], 'bn');
    expect(missing).toContain('অ');
    expect(missing).toContain('ক');
    expect(missing).toContain('্');
    expect(missing).toContain('৳');
  });

  it('refuses a Bengali-only file for English', () => {
    expect(missingLetters([hindBengali], 'en')).toContain('A');
    expect(missingLetters([nunitoLatin], 'en')).toEqual([]);
  });

  it('takes the union of a weight’s files: the Latin and Bengali subsets together', () => {
    expect(missingLetters([hindBengali, hindLatin], 'en')).toEqual([]);
  });
});
