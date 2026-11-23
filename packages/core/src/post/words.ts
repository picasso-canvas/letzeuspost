/**
 * Words in a slide text, the way §07's rules count them (cover title ≤ 8, list item ≤ 8): runs of text between
 * spaces. The `*` that marks a highlight (`*word*`, `*two words*`) is not a word and not part of one.
 */
export const countWords = (text: string): number =>
  text
    .replaceAll('*', '')
    .split(/\s+/u)
    .filter((word) => word !== '').length;
