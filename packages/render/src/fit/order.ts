import { SIZES, type SizeName } from '../sizes.ts';

const textRoom = (size: SizeName): number =>
  SIZES[size].textArea.width * SIZES[size].textArea.height;

/**
 * The order to render a post's sizes in (§08 The shortening loop): the size with the least text room first, so a
 * failure shows up early. Room is the text area, the page minus its margins; each size once.
 */
export const fitOrder = (sizes: readonly SizeName[]): SizeName[] =>
  [...new Set(sizes)].sort((a, b) => textRoom(a) - textRoom(b));
