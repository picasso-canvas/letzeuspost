/** One problem found in a text. `start` and `end` are UTF-16 indices into the text that was checked; `end` is
 * exclusive (like `String.prototype.slice`). */
export type TextIssue = {
  code: TextIssueCode;
  severity: 'error' | 'warning';
  start: number;
  end: number;
};

export type TextIssueCode =
  | 'orphan-vowel-sign'
  | 'orphan-hasanta'
  | 'invisible-character'
  | 'latin-digit-in-bangla'
  | 'emoji-on-slide'
  | 'highlight-inside-word'
  | 'highlight-unmatched';
