import { SIZE_NAMES, type SizeName } from '@lzp/core';

// §08's "Sizes and arrangements" table. The pixels are the same as `config/networks.ts` (a test checks); the margins,
// safe zones and body floors are the renderer's. Layout geometry, type scale and safe zones are not switches (§07).
export { SIZE_NAMES, type SizeName };

/** A distance in pixels from each edge of the page. */
export type Edges = { top: number; right: number; bottom: number; left: number };

export type SizeSpec = {
  width: number;
  height: number;
  /** The page minus its margins: where text may go. */
  textArea: { width: number; height: number };
  margins: Edges;
  /** Text stays out of these. Equal to the margins everywhere (§07: feed sizes keep their margin); a story's are the larger overlay zones. */
  safeZones: Edges;
  /** `stacked`: blocks one under another. `columns`: text left, a second column right (16:9). */
  arrangement: 'stacked' | 'columns';
  /** Body text never goes below this, in pixels: 32 at 1080 wide, 36 for landscape (1200 wide), 24 for pins (§07, §08). */
  bodyFloor: number;
};

/** Sources, credits and page numbers: a fixed 28 px, never scaled (§08 decision 5). */
export const SMALL_PRINT_PX = 28;

const all = (px: number): Edges => ({ top: px, right: px, bottom: px, left: px });

function size(
  width: number,
  height: number,
  margins: Edges,
  arrangement: SizeSpec['arrangement'],
  bodyFloor: number,
): SizeSpec {
  return {
    width,
    height,
    textArea: {
      width: width - margins.left - margins.right,
      height: height - margins.top - margins.bottom,
    },
    margins,
    safeZones: margins,
    arrangement,
    bodyFloor,
  };
}

export const SIZES: Record<SizeName, SizeSpec> = {
  portrait: size(1080, 1350, all(64), 'stacked', 32),
  square: size(1080, 1080, all(64), 'stacked', 32),
  // The stricter of Instagram's and TikTok's story overlays (§07 Safe zones).
  story: size(1080, 1920, { top: 250, right: 130, bottom: 384, left: 72 }, 'stacked', 32),
  landscape: size(1200, 675, all(56), 'columns', 36),
  pin: size(1000, 1500, all(60), 'stacked', 24),
};
