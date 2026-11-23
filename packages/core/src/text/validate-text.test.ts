import { describe, expect, it } from 'vitest';
import { graphemes } from './graphemes.ts';
import type { TextIssueCode } from './issues.ts';
import { validateText } from './validate-text.ts';

// Built from code points, so the invisible characters can be seen in the source.
const ZWJ = String.fromCodePoint(0x200d);
const ZWNJ = String.fromCodePoint(0x200c);
const ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff);
const WORD_JOINER = String.fromCodePoint(0x2060);
const RLO = String.fromCodePoint(0x202e);
const LRM = String.fromCodePoint(0x200e);
const PICTURE_SELECTOR = String.fromCodePoint(0xfe0f);
const bnSlide = { lang: 'bn', surface: 'slide' } as const;
const enSlide = { lang: 'en', surface: 'slide' } as const;
const enCaption = { lang: 'en', surface: 'caption' } as const;

type Row = { name: string; input: string; graphemes: number; codes: TextIssueCode[] };

// Expected grapheme counts, counted by hand from the Unicode 15.1 rules (UAX #29 with GB9c): a Bangla consonant,
// a hasanta (virama) and another consonant make one conjunct; vowel signs, nukta, candrabindu, anusvara and
// visarga attach to the letter before them; a space or digit is its own grapheme. The counts are never taken from
// the code under test. `codes` lists the issues the validator must report, in order of position.
//
// A hasanta followed by a letter with no consonant before it ('্ক', 'কা্ক') is left out on purpose: GB9c says two
// graphemes, but the pinned ICU joins them. Text that has such a sequence is an error anyway.
const BANGLA_SET: Row[] = [
  // correct text
  { name: 'বাংলা (anusvara)', input: 'বাংলা', graphemes: 2, codes: [] }, // বাং · লা
  { name: 'বাংলাদেশ', input: 'বাংলাদেশ', graphemes: 4, codes: [] }, // বাং · লা · দে · শ
  { name: 'conjunct ক্ষ', input: 'ক্ষ', graphemes: 1, codes: [] }, // ক ্ ষ
  { name: 'conjunct with a vowel sign ক্ষি', input: 'ক্ষি', graphemes: 1, codes: [] },
  { name: 'three-letter conjunct স্ত্রী', input: 'স্ত্রী', graphemes: 1, codes: [] }, // স ্ ত ্ র ী
  { name: 'বিশ্বাস', input: 'বিশ্বাস', graphemes: 3, codes: [] }, // বি · শ্বা · স
  { name: 'কৃষ্ণ (vocalic r sign)', input: 'কৃষ্ণ', graphemes: 2, codes: [] }, // কৃ · ষ্ণ
  { name: 'reph in ধর্ম', input: 'ধর্ম', graphemes: 2, codes: [] }, // ধ · র্ম
  { name: 'ya-phala in বাক্য', input: 'বাক্য', graphemes: 2, codes: [] }, // বা · ক্য
  { name: 'ব্যবহার', input: 'ব্যবহার', graphemes: 4, codes: [] }, // ব্য · ব · হা · র
  { name: 'ZWJ word র‍্যাংকিং', input: `র${ZWJ}্যাংকিং`, graphemes: 2, codes: [] }, // র‍্যাং · কিং
  { name: 'ZWJ word র‍্যাব', input: `র${ZWJ}্যাব`, graphemes: 2, codes: [] }, // র‍্যা · ব
  { name: 'ZWNJ breaks a conjunct', input: `ক্${ZWNJ}ষ`, graphemes: 2, codes: [] }, // ক্‌ · ষ
  { name: 'candrabindu in চাঁদ', input: 'চাঁদ', graphemes: 2, codes: [] }, // চাঁ · দ
  { name: 'visarga in দুঃখ', input: 'দুঃখ', graphemes: 2, codes: [] }, // দুঃ · খ
  { name: 'independent vowel in ঋষি', input: 'ঋষি', graphemes: 2, codes: [] }, // ঋ · ষি
  { name: 'nukta (ড + ়) in পড়া', input: 'পড়া', graphemes: 2, codes: [] }, // প · ড়া
  { name: 'ঙ্গ in সঙ্গে', input: 'সঙ্গে', graphemes: 2, codes: [] }, // স · ঙ্গে
  { name: 'four-letter conjunct লক্ষ্মী', input: 'লক্ষ্মী', graphemes: 2, codes: [] }, // ল · ক্ষ্মী
  { name: 'double conjunct উজ্জ্বল', input: 'উজ্জ্বল', graphemes: 3, codes: [] }, // উ · জ্জ্ব · ল
  { name: 'two words', input: 'বাংলা ভাষা', graphemes: 5, codes: [] }, // বাং · লা · space · ভা · ষা
  { name: 'Bangla digits', input: 'শহর ১২৩', graphemes: 7, codes: [] }, // শ · হ · র · space · ১ · ২ · ৩
  { name: 'ya-phala, candrabindu in হ্যাঁ', input: 'হ্যাঁ', graphemes: 1, codes: [] }, // হ ্ য া ঁ
  { name: 'khanda ta in উৎসব', input: 'উৎসব', graphemes: 4, codes: [] }, // উ · ৎ · স · ব
  { name: 'ক্রিয়া', input: 'ক্রিয়া', graphemes: 2, codes: [] }, // ক্রি · য়া
  { name: 'English next to Bangla', input: 'Hi বাংলা', graphemes: 5, codes: [] }, // H · i · space · বাং · লা
  { name: 'ো as two signs (ে + া)', input: 'কো', graphemes: 1, codes: [] }, // ক ে া
  { name: 'সংখ্যা', input: 'সংখ্যা', graphemes: 2, codes: [] }, // সং · খ্যা
  // dotted-circle cases
  { name: 'a vowel sign alone', input: 'ি', graphemes: 1, codes: ['orphan-vowel-sign'] },
  {
    name: 'a vowel sign after a space',
    input: ' া',
    graphemes: 1, // a spacing mark joins the space before it
    codes: ['orphan-vowel-sign'],
  },
  {
    name: 'a vowel sign after a space inside text',
    input: 'ক ি',
    graphemes: 2, // ক · space+ি
    codes: ['orphan-vowel-sign'],
  },
  {
    name: 'a vowel sign after a vowel sign',
    input: 'কাি',
    graphemes: 1,
    codes: ['orphan-vowel-sign'],
  },
  {
    name: 'a vowel sign after a hasanta',
    input: 'ক্ি',
    graphemes: 1,
    codes: ['orphan-vowel-sign'],
  },
  {
    name: 'a vowel sign after a Latin letter',
    input: 'aি',
    graphemes: 1,
    codes: ['orphan-vowel-sign'],
  },
  {
    name: 'an anusvara after an anusvara',
    input: 'বাংং',
    graphemes: 1,
    codes: ['orphan-vowel-sign'],
  },
  { name: 'a hasanta alone', input: '্', graphemes: 1, codes: ['orphan-hasanta'] },
  {
    name: 'two hasantas in a row',
    input: 'ক্্ক',
    graphemes: 1, // GB9c allows more than one linker between consonants
    codes: ['orphan-hasanta'],
  },
  {
    name: 'a hasanta after a vowel sign',
    input: 'কা্',
    graphemes: 1,
    codes: ['orphan-hasanta'],
  },
  {
    name: 'a hasanta after a space',
    input: 'ক ্',
    graphemes: 2, // ক · space+্ (a hasanta, like any extender, joins the character before it)
    codes: ['orphan-hasanta'],
  },
  {
    name: 'a ZWJ does not give a vowel sign a letter',
    input: `${ZWJ}ি`,
    graphemes: 1,
    codes: ['orphan-vowel-sign'],
  },
  // invisible characters
  {
    name: 'a zero-width space is removed',
    input: `ক${ZWSP}ি`,
    graphemes: 1,
    codes: ['invisible-character'],
  },
  {
    name: 'a BOM is removed',
    input: `${BOM}বাংলা`,
    graphemes: 2,
    codes: ['invisible-character'],
  },
  // digits
  {
    name: 'Latin digits mixed in',
    input: 'দাম 100 টাকা',
    graphemes: 9, // দা · ম · space · 1 · 0 · 0 · space · টা · কা
    codes: ['latin-digit-in-bangla'],
  },
  {
    name: 'a year in Latin digits',
    input: 'বাংলা 2024 সাল',
    graphemes: 10, // বাং · লা · space · 2 · 0 · 2 · 4 · space · সা · ল
    codes: ['latin-digit-in-bangla'],
  },
  {
    name: 'two separate Latin digits',
    input: 'ক1খ2',
    graphemes: 4,
    codes: ['latin-digit-in-bangla', 'latin-digit-in-bangla'],
  },
  { name: 'Bangla digits alone', input: '২০২৪', graphemes: 4, codes: [] },
];

describe('validateText: the Bangla test set', () => {
  it('has at least 30 strings', () => {
    expect(BANGLA_SET.length).toBeGreaterThanOrEqual(30);
  });

  it.each(BANGLA_SET)('$name', (row) => {
    const result = validateText(row.input, bnSlide);
    expect(graphemes(result.text)).toHaveLength(row.graphemes);
    expect(result.issues.map((issue) => issue.code)).toEqual(row.codes);
  });
});

describe('validateText: what an issue carries', () => {
  it('gives a code, a severity and the index range of a lone vowel sign', () => {
    expect(validateText('ি', bnSlide).issues).toEqual([
      { code: 'orphan-vowel-sign', severity: 'error', start: 0, end: 1 },
    ]);
  });

  it('points at the sign itself, not at the text before it', () => {
    expect(validateText('ক ি', bnSlide).issues).toEqual([
      { code: 'orphan-vowel-sign', severity: 'error', start: 2, end: 3 },
    ]);
  });

  it('reports a hasanta with no letter as an orphan hasanta', () => {
    expect(validateText('আ ্', bnSlide).issues).toEqual([
      { code: 'orphan-hasanta', severity: 'error', start: 2, end: 3 },
    ]);
  });

  it('returns the text unchanged when it is clean', () => {
    expect(validateText('বাংলাদেশ', bnSlide)).toEqual({ text: 'বাংলাদেশ', issues: [] });
  });

  it('returns the text even when it has errors', () => {
    expect(validateText('ি', bnSlide).text).toBe('ি');
  });

  it('checks Bangla signs in English text too (they would print as ◌ just the same)', () => {
    const issues = validateText('Hello ি', enCaption).issues;
    expect(issues.map((issue) => issue.code)).toEqual(['orphan-vowel-sign']);
  });
});

describe('validateText: invisible characters', () => {
  it('keeps the zero-width joiner and non-joiner', () => {
    const joiner = `র${ZWJ}্যাংকিং`;
    const nonJoiner = `ক্${ZWNJ}ষ`;
    expect(validateText(joiner, bnSlide).text).toBe(joiner);
    expect(validateText(nonJoiner, bnSlide).text).toBe(nonJoiner);
  });

  it('removes zero-width space, BOM, word joiner and bidi controls, and reports each run', () => {
    const input = `ক${ZWSP}${ZWSP}খ${BOM}${WORD_JOINER}${RLO}গ${LRM}`;
    expect(validateText(input, bnSlide)).toEqual({
      text: 'কখগ',
      issues: [
        { code: 'invisible-character', severity: 'warning', start: 1, end: 3 },
        { code: 'invisible-character', severity: 'warning', start: 4, end: 7 },
        { code: 'invisible-character', severity: 'warning', start: 8, end: 9 },
      ],
    });
  });

  it('removes the other bidi controls (isolates, embeddings, marks) and the soft hyphen', () => {
    // LRE RLE PDF LRO, LRI RLI FSI PDI, RLM, ALM, soft hyphen
    const controls = String.fromCodePoint(
      ...[0x202a, 0x202b, 0x202c, 0x202d, 0x2066, 0x2067, 0x2068, 0x2069, 0x200f, 0x061c, 0x00ad],
    );
    const result = validateText(`${controls}a`, enSlide);
    expect(result.text).toBe('a');
    expect(result.issues).toEqual([
      { code: 'invisible-character', severity: 'warning', start: 0, end: 11 },
    ]);
  });

  it('judges the signs on the cleaned text, and reports positions in the original text', () => {
    // A zero-width space between the letter and its vowel sign is removed, so কি is correct.
    expect(validateText(`ক${ZWSP}ি`, bnSlide).issues.map((issue) => issue.code)).toEqual([
      'invisible-character',
    ]);
    // With nothing before the sign, the error points at the sign's place in the original (index 1).
    expect(validateText(`${ZWSP}ি`, bnSlide).issues).toEqual([
      { code: 'invisible-character', severity: 'warning', start: 0, end: 1 },
      { code: 'orphan-vowel-sign', severity: 'error', start: 1, end: 2 },
    ]);
  });
});

describe('validateText: digits and emoji', () => {
  it('warns about Latin digits in Bangla text, one issue for each run', () => {
    expect(validateText('দাম 100 টাকা, 25%', bnSlide).issues).toEqual([
      { code: 'latin-digit-in-bangla', severity: 'warning', start: 4, end: 7 },
      { code: 'latin-digit-in-bangla', severity: 'warning', start: 14, end: 16 },
    ]);
  });

  it('warns on a caption too', () => {
    const issues = validateText('দাম 100', { lang: 'bn', surface: 'caption' }).issues;
    expect(issues.map((issue) => issue.severity)).toEqual(['warning']);
  });

  it('accepts Latin digits in English text', () => {
    expect(validateText('Call 100 now', enSlide).issues).toEqual([]);
  });

  it('rejects an emoji on a slide', () => {
    expect(validateText('Sale 🎉', enSlide).issues).toEqual([
      { code: 'emoji-on-slide', severity: 'error', start: 5, end: 7 },
    ]);
  });

  it('rejects an emoji on a Bangla slide', () => {
    const issues = validateText('অফার 🎉', bnSlide).issues;
    expect(issues.map((issue) => issue.code)).toEqual(['emoji-on-slide']);
  });

  it('accepts an emoji in a caption', () => {
    expect(validateText('Sale 🎉', enCaption).issues).toEqual([]);
  });

  it('reports a flag, a heart with a picture selector and a joined family as one range each', () => {
    expect(validateText('🇧🇩', enSlide).issues).toEqual([
      { code: 'emoji-on-slide', severity: 'error', start: 0, end: 4 },
    ]);
    expect(validateText(`Hi ❤${PICTURE_SELECTOR}`, enSlide).issues).toEqual([
      { code: 'emoji-on-slide', severity: 'error', start: 3, end: 5 },
    ]);
    expect(validateText(`👨${ZWJ}👩${ZWJ}👧`, enSlide).issues).toEqual([
      { code: 'emoji-on-slide', severity: 'error', start: 0, end: 8 },
    ]);
  });

  it('keeps the joiner inside an emoji sequence on a caption', () => {
    const family = `👨${ZWJ}👩${ZWJ}👧`;
    expect(validateText(family, enCaption).text).toBe(family);
  });

  it('does not take plain symbols and digits for emoji', () => {
    expect(validateText('© 2026 ™ #1 *', enSlide).issues).toEqual([]);
  });
});
