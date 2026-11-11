const letterOrDigit = /[\p{L}\p{N}]/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The letters on an avatar with no picture: the first letter of each of the first two words in a name, in capitals.
 * A letter is a whole grapheme, so a Bangla vowel sign stays with its consonant; words with no letter or digit in
 * them ("&") are skipped.
 */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .flatMap((word) => {
      const first = [...graphemes.segment(word)].find((g) => letterOrDigit.test(g.segment));
      return first === undefined ? [] : [first.segment.toLocaleUpperCase()];
    })
    .slice(0, 2)
    .join('');
}
