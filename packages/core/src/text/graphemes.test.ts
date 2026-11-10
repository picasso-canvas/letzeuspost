import { describe, expect, it } from 'vitest';
import { graphemes } from './graphemes.ts';

describe('graphemes', () => {
  it('returns nothing for an empty string', () => {
    expect(graphemes('')).toEqual([]);
  });

  it('splits English text into single letters, spaces included', () => {
    expect(graphemes('Hi you')).toEqual(['H', 'i', ' ', 'y', 'o', 'u']);
  });

  it('keeps a letter and its combining accent together', () => {
    expect(graphemes('éa')).toEqual(['é', 'a']);
  });

  it('counts the Bangla conjunct ক্ষ as one grapheme', () => {
    expect(graphemes('ক্ষ')).toEqual(['ক্ষ']);
  });

  it('counts a conjunct with a vowel sign (ক্ষি) as one grapheme', () => {
    expect(graphemes('ক্ষি')).toHaveLength(1);
  });

  it('counts a three-letter conjunct with a vowel sign (স্ত্রী) as one grapheme', () => {
    expect(graphemes('স্ত্রী')).toHaveLength(1);
  });

  it('keeps vowel signs and the anusvara with their letter (বাংলাদেশ is 4)', () => {
    expect(graphemes('বাংলাদেশ')).toEqual(['বাং', 'লা', 'দে', 'শ']);
  });

  it('keeps the zero-width joiner inside র‍্যা (র‍্যাংকিং is 2)', () => {
    expect(graphemes('র‍্যাংকিং')).toEqual(['র‍্যাং', 'কিং']);
  });

  it('counts a Bangla word with a space between the words', () => {
    expect(graphemes('ক্ষ ক')).toEqual(['ক্ষ', ' ', 'ক']);
  });

  it('counts an emoji with a skin tone as one grapheme', () => {
    expect(graphemes('👍🏽')).toEqual(['👍🏽']);
  });

  it('counts a family emoji joined with ZWJ as one grapheme', () => {
    expect(graphemes('👨‍👩‍👧')).toHaveLength(1);
  });

  it('counts a flag (two regional indicators) as one grapheme', () => {
    expect(graphemes('🇧🇩🇺🇸')).toEqual(['🇧🇩', '🇺🇸']);
  });

  it('counts a keycap emoji as one grapheme', () => {
    expect(graphemes('1️⃣')).toHaveLength(1);
  });

  it('keeps a CRLF line break as one grapheme', () => {
    expect(graphemes('a\r\nb')).toEqual(['a', '\r\n', 'b']);
  });
});
