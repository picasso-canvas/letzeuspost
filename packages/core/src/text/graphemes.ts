// 'und' (no language) keeps the result the same on every machine; the rules come from the ICU that the worker image
// pins (§08). Unicode 15.1 added the Indic conjunct rule, so a Bangla conjunct such as ক্ষ is one grapheme.
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** Splits text into user-perceived characters (extended grapheme clusters, Unicode 15.1). */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}
