import { applyContrast, type ContrastResult, type ContrastWarning } from '../../contrast/apply.ts';
import { parseHex, toHex } from '../../contrast/colour.ts';
import { checkPairs, resolveColour, type LayoutPair, type TextPair } from '../../contrast/pairs.ts';
import { K_MIN } from '../../fit/report.ts';
import type { RenderKit } from '../../kit.ts';
import { sizeCss } from '../../page/base-css.ts';
import { SIZE_NAMES, SIZES, SMALL_PRINT_PX, type SizeName } from '../../sizes.ts';
import { PLAYFUL_BADGE_TINT } from './tokens.ts';

// The Playful look's text pairs for the contrast check (§07 Contrast, §08: each text/background pair, at its real size,
// on the tokens). Playful's text sits on the kit's background (the ground, and the tag sticker, which is the same
// colour), on the badge sticker that may lie behind it (the accent mixed into the background, as `css.ts` mixes it),
// and, for the pill highlight, on the accent itself.
//
// Which colour is shaded when a pair fails (`applyContrast` shades the text colour when it is the kit's): on the ground
// and the badge, the text colour (ink, primary); on the pill, the accent, since ink must also hold on the ground. The
// pill pairs therefore give the ink as a fixed colour, taken from the kit as it stands.

/** `color-mix(in srgb, a share, b)`: each channel mixed in sRGB, as the browser does for opaque colours. */
function mix(a: string, share: number, b: string): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  const channel = (i: 0 | 1 | 2): number => x[i] * share + y[i] * (1 - share);
  return toHex([channel(0), channel(1), channel(2)]);
}

/** The colour Playful mixes from the kit: the badge sticker, the accent mixed into the background. */
export function playfulTints(kit: RenderKit): { badge: string } {
  return { badge: mix(kit.colors.accent, PLAYFUL_BADGE_TINT, kit.colors.background) };
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

type Text = Omit<LayoutPair, 'on'> & { text: 'ink' | 'primary'; pill?: true };

/** Each text the look draws at `size`, at the smallest size the fit check can set it, and whether it can be a pill. */
function texts(size: SizeName): Text[] {
  const scale = typeScale(size);
  const title = scale.title * K_MIN;
  const body = Math.max(SIZES[size].bodyFloor, scale.body * K_MIN);
  const kicker = scale.kicker * K_MIN;
  // Highlights are in the primary (underline, colour), or ink on the pill (the default)
  return [
    { name: 'title', text: 'ink', px: title, headline: true },
    { name: 'title highlight', text: 'primary', px: title, headline: true, pill: true },
    { name: 'kicker', text: 'primary', px: kicker },
    { name: 'kicker highlight', text: 'primary', px: kicker, pill: true },
    { name: 'body', text: 'ink', px: body },
    { name: 'body highlight', text: 'primary', px: body, pill: true },
    { name: 'small print', text: 'ink', px: SMALL_PRINT_PX },
  ];
}

const named = (text: Text, where: string, size: SizeName): Omit<TextPair, 'text' | 'on'> => ({
  name: `playful: ${text.name} on ${where}`,
  px: text.px,
  width: SIZES[size].width,
  ...(text.headline === true ? { headline: true } : {}),
});

/** The pairs whose text colour is shaded when they fail: every text on the ground and on the badge. */
function textPairs(kit: RenderKit, size: SizeName): TextPair[] {
  const { badge } = playfulTints(kit);
  return texts(size).flatMap((text): TextPair[] => [
    { ...named(text, 'ground', size), text: text.text, on: 'background' },
    { ...named(text, 'badge', size), text: text.text, on: { hex: badge } },
  ]);
}

/** The pill pairs: ink, as the kit has it, on the accent, which is what is shaded when they fail. */
function pillPairs(kit: RenderKit, size: SizeName): TextPair[] {
  const ink = { hex: resolveColour(kit, 'ink') };
  return texts(size)
    .filter((text) => text.pill === true)
    .map((text): TextPair => ({ ...named(text, 'pill', size), text: ink, on: 'accent' }));
}

/**
 * Every text pair the Playful look draws at `size`: each text on the ground and on the badge, and each highlight on
 * the pill, at the smallest size the fit check can set it (`K_MIN`; the body never under its floor, small print a fixed
 * 28 px). The title is the headline.
 */
export function playfulPairs(kit: RenderKit, size: SizeName): TextPair[] {
  return [...textPairs(kit, size), ...pillPairs(kit, size)];
}

const atEverySize = (pairs: (kit: RenderKit, size: SizeName) => TextPair[], kit: RenderKit) =>
  SIZE_NAMES.flatMap((size) => pairs(kit, size));

/** Shading the accent moves the badge, and shading the ink moves the pill pairs; a few rounds settle it. */
const MAX_ROUNDS = 4;

/**
 * The contrast check and auto-shading for the Playful look (`applyContrast`, §07: a failing colour is shaded and the
 * editor warned), on the pairs above at every size. Each round shades the accent for the pill pairs first, then the ink
 * and the primary for the rest, on the badge mixed from that accent, until nothing more changes. Each warning says
 * what the colour was in the kit given and what it ends as; what no shade fixes is a failure.
 */
export function playfulContrast(kit: RenderKit): ContrastResult {
  let current = kit;
  const warnings = new Map<string, ContrastWarning>();
  const note = (result: ContrastResult): void => {
    for (const warning of result.warnings) {
      const earlier = warnings.get(warning.colour);
      warnings.set(warning.colour, {
        ...warning,
        from: earlier?.from ?? warning.from,
        pairs: [...new Set([...(earlier?.pairs ?? []), ...warning.pairs])],
      });
    }
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pill = applyContrast(current, 'playful', atEverySize(pillPairs, current));
    note(pill);
    const text = applyContrast(pill.kit, 'playful', atEverySize(textPairs, pill.kit));
    note(text);
    if (text.kit === current) break;
    current = text.kit;
  }
  const failures = checkPairs(current, 'playful', atEverySize(playfulPairs, current)).filter(
    (result) => !result.passes,
  );
  return { kit: current, warnings: [...warnings.values()], failures };
}
