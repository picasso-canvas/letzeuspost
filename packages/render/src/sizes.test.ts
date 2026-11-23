import { describe, expect, it } from 'vitest';
import { sizes as networkSizes } from '../../../config/networks.ts';
import { SIZE_NAMES, SIZES, SMALL_PRINT_PX } from './sizes.ts';

describe('SIZES', () => {
  it('holds the five sizes', () => {
    expect(Object.keys(SIZES).sort()).toEqual([...SIZE_NAMES].sort());
  });

  it.each(SIZE_NAMES)('%s has the pixels of config/networks.ts', (name) => {
    expect(SIZES[name].width).toBe(networkSizes[name].width);
    expect(SIZES[name].height).toBe(networkSizes[name].height);
  });

  it.each(SIZE_NAMES)('%s: the text area is the page minus its margins', (name) => {
    const { width, height, margins, textArea } = SIZES[name];
    expect(textArea.width).toBe(width - margins.left - margins.right);
    expect(textArea.height).toBe(height - margins.top - margins.bottom);
  });

  // §08's table, row by row.
  it.each([
    ['portrait', 952, 1222, 'stacked', 32],
    ['square', 952, 952, 'stacked', 32],
    ['story', 878, 1286, 'stacked', 32],
    ['landscape', 1088, 563, 'columns', 36],
    ['pin', 880, 1380, 'stacked', 24],
  ] as const)('%s: text area %i × %i, %s, body floor %i', (name, w, h, arrangement, floor) => {
    expect(SIZES[name].textArea).toEqual({ width: w, height: h });
    expect(SIZES[name].arrangement).toBe(arrangement);
    expect(SIZES[name].bodyFloor).toBe(floor);
  });

  it('keeps 64 px feed margins, 56 on landscape and 60 on pins', () => {
    expect(SIZES.portrait.margins).toEqual({ top: 64, right: 64, bottom: 64, left: 64 });
    expect(SIZES.square.margins).toEqual({ top: 64, right: 64, bottom: 64, left: 64 });
    expect(SIZES.landscape.margins).toEqual({ top: 56, right: 56, bottom: 56, left: 56 });
    expect(SIZES.pin.margins).toEqual({ top: 60, right: 60, bottom: 60, left: 60 });
  });

  it("gives a story the stricter of Instagram's and TikTok's overlays as safe zones", () => {
    expect(SIZES.story.safeZones).toEqual({ top: 250, right: 130, bottom: 384, left: 72 });
    expect(SIZES.story.margins).toEqual(SIZES.story.safeZones);
  });

  it('keeps small print at a fixed 28 px', () => {
    expect(SMALL_PRINT_PX).toBe(28);
  });
});
