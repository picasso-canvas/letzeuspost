import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Base64 } from './sha256.ts';

// The page builder also runs in the browser (§08), where node:crypto doesn't exist, so the hash of the fit script
// for the content policy is computed here. It must equal the browser's: sha256 of the UTF-8 bytes, in base64.
const reference = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64');

describe('sha256Base64', () => {
  it.each([
    ['empty', ''],
    ['one block boundary: 55 bytes', 'a'.repeat(55)],
    ['56 bytes: the length no longer fits the block', 'a'.repeat(56)],
    ['64 bytes: exactly one block', 'a'.repeat(64)],
    ['a long text', 'The quick brown fox jumps over the lazy dog. '.repeat(500)],
    ['Bangla, which is three bytes a letter', 'ফিরে এল পিঠা সপ্তাহ ক্ষ'],
    ['a character outside the BMP', 'a😀b'],
    ['script-like text', 'if (a < b && c > "d") { fit(); }'],
  ])('matches node:crypto for %s', (_name, text) => {
    expect(sha256Base64(text)).toBe(reference(text));
  });
});
