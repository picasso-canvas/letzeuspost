const letterOrDigit = /[\p{L}\p{N}]/u;
const bengali = /\p{Script=Bengali}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first letter of a word, as a whole grapheme, or nothing for a word with no letter or digit in it ("&"). */
function firstLetter(word: string): string | undefined {
  return [...graphemes.segment(word)].find((g) => letterOrDigit.test(g.segment))?.segment;
}

/**
 * The letters on an avatar with no picture. An English name gives the first letter of each of the first two words, in
 * capitals; words with no letter or digit in them ("&") are skipped. A Bangla name (one with a Bengali letter in it)
 * gives only the first letter of its first word, so "ঢাকা ও সিলেট" is "ঢা", not a letter from the joining word
 * (Zeus, 2026-11-11, #223). A letter is a whole grapheme, so a Bangla vowel sign or a joined consonant stays with its
 * consonant and is never cut.
 */
export function initialsOf(name: string): string {
  const firstLetters = name
    .split(/\s+/)
    .flatMap((word) => firstLetter(word) ?? [])
    .map((letter) => letter.toLocaleUpperCase());
  return firstLetters.slice(0, bengali.test(name) ? 1 : 2).join('');
}
