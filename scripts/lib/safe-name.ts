/** File names are builder-controlled: printable text only, so a name can't break out of a code span or block. */
export function safeName(name: string): string {
  // Control and format characters (newlines, bidi, zero-width) would make a name display as another.
  return name.replace(/[^\x20-\x7e\u00a0-\uffff]|\p{Cf}/gu, '?').replace(/`/g, "'");
}
