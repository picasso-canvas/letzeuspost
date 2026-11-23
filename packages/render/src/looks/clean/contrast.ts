import { applyContrast, type ContrastResult, type ContrastWarning } from '../../contrast/apply.ts';
import { parseHex, toHex } from '../../contrast/colour.ts';
import {
  checkPairs,
  type LayoutPair,
  type TextColour,
  type TextPair,
} from '../../contrast/pairs.ts';
import { K_MIN } from '../../fit/report.ts';
import type { RenderKit } from '../../kit.ts';
import { sizeCss } from '../../page/base-css.ts';
import { SIZE_NAMES, SIZES, SMALL_PRINT_PX, type SizeName } from '../../sizes.ts';
import { CLEAN_TINT } from './tokens.ts';

// The Clean look's text pairs for the contrast check (§07 Contrast, §08: each text/background pair, at its real size,
// on the tokens). Clean's text never sits on the kit's background itself: it sits on the tinted ground, on the
// decoration shape, or (the pill highlight) on the pill, which `css.ts` mixes from the primary with `color-mix`.
// Those mixes are worked out here the same way, so the check judges the colours the page really paints.

/** `color-mix(in srgb, a share, b)`: each channel mixed in sRGB, as the browser does for opaque colours. */
function mix(a: string, share: number, b: string): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  const channel = (i: 0 | 1 | 2): number => x[i] * share + y[i] * (1 - share);
  return toHex([channel(0), channel(1), channel(2)]);
}

/** The colours Clean mixes from the kit's primary and background: the ground, the decoration shape and the pill. */
export function cleanTints(kit: RenderKit): { ground: string; shape: string; pill: string } {
  const { primary, background } = kit.colors;
  return {
    ground: mix(primary, CLEAN_TINT.ground, background),
    shape: mix(primary, CLEAN_TINT.shape, background),
    pill: mix(primary, CLEAN_TINT.pill, background),
  };
}

/** A size's type scale at `--k: 1`, read from the base CSS itself, so the pairs can't drift from the page. */
function typeScale(size: SizeName): { title: number; body: number; kicker: number } {
  const css = sizeCss(size);
  const px = (name: string): number => {
    const value = new RegExp(`--${name}: ([\\d.]+)px;`).exec(css)?.[1];
    if (value === undefined) throw new Error(`The base CSS has no --${name} for ${size}`);
    return Number(value);
  };
  return { title: px('title-size'), body: px('body-size'), kicker: px('kicker-size') };
}

/**
 * Every text pair the Clean look draws at `size`, on every colour it can sit on (the ground, and the decoration shape
 * that may lie behind it), at the smallest size the fit check can set it (`K_MIN`; the body never under its floor,
 * small print a fixed 28 px). The title is the headline. Highlights are in the primary (underline, colour), or ink on
 * the pill.
 */
export function cleanPairs(kit: RenderKit, size: SizeName): TextPair[] {
  const { ground, shape, pill } = cleanTints(kit);
  const scale = typeScale(size);
  const title = scale.title * K_MIN;
  const body = Math.max(SIZES[size].bodyFloor, scale.body * K_MIN);
  const kicker = scale.kicker * K_MIN;
  // Each text, and whether a highlight in it can be a pill (ink on the pill, whatever colour the text has otherwise)
  const texts: (Omit<LayoutPair, 'on'> & { pill?: true })[] = [
    { name: 'title', text: 'ink', px: title, headline: true },
    { name: 'title highlight', text: 'primary', px: title, headline: true, pill: true },
    { name: 'kicker', text: 'primary', px: kicker },
    { name: 'kicker highlight', text: 'primary', px: kicker, pill: true },
    { name: 'body', text: 'ink', px: body },
    { name: 'body highlight', text: 'primary', px: body, pill: true },
    { name: 'small print', text: 'ink', px: SMALL_PRINT_PX },
  ];
  return texts.flatMap(({ pill: hasPill, ...text }) => {
    const on = (where: string, backdrop: string, colour: TextColour = text.text): TextPair => ({
      ...text,
      name: `clean: ${text.name} on ${where}`,
      text: colour,
      on: { hex: backdrop },
      width: SIZES[size].width,
    });
    return [
      on('ground', ground),
      on('shape', shape),
      ...(hasPill === true ? [on('pill', pill, 'ink')] : []),
    ];
  });
}

/** Every Clean pair at every size, for one kit. */
const allPairs = (kit: RenderKit): TextPair[] =>
  SIZE_NAMES.flatMap((size) => cleanPairs(kit, size));

/** Shading the primary moves the tints mixed from it; a few rounds settle it, and what is left is a failure. */
const MAX_ROUNDS = 4;

/**
 * The contrast check and auto-shading for the Clean look (`applyContrast`, §07: a failing colour is shaded and the
 * editor warned), on the pairs above at every size. Clean's tints are mixed from the primary, so a shaded primary
 * changes what the text sits on: the check runs again on the tints of the shaded kit until nothing more changes. Each
 * warning says what the colour was in the kit given and what it ends as.
 */
export function cleanContrast(kit: RenderKit): ContrastResult {
  let current = kit;
  const warnings = new Map<string, ContrastWarning>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = applyContrast(current, 'clean', allPairs(current));
    for (const warning of result.warnings) {
      const earlier = warnings.get(warning.colour);
      warnings.set(warning.colour, {
        ...warning,
        from: earlier?.from ?? warning.from,
        pairs: [...new Set([...(earlier?.pairs ?? []), ...warning.pairs])],
      });
    }
    if (result.kit === current)
      return { kit: current, warnings: [...warnings.values()], failures: result.failures };
    current = result.kit;
  }
  const failures = checkPairs(current, 'clean', allPairs(current)).filter((r) => !r.passes);
  return { kit: current, warnings: [...warnings.values()], failures };
}
