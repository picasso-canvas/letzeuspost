import type { LookName } from '@lzp/core';
import type { RenderKit } from '../kit.ts';
import { SIZE_NAMES } from '../sizes.ts';
import {
  checkPairs,
  pairsFor,
  registeredLayouts,
  resolveColour,
  type Backdrop,
  type KitColour,
  type PairResult,
  type TextPair,
} from './pairs.ts';
import { shadeToPass } from './shade.ts';

// Auto-shading of a brand kit that fails the contrast check (§07 Contrast, §08): the look uses a darker or lighter
// shade of the failing colour, and the editor is warned.

/** One colour of the kit that was shaded: which one, from what, to what, and the pairs that made it fail. */
export type ContrastWarning = {
  /** `ink`, `accent`, `primary`, `background` or `extras[0]`. */
  colour: string;
  look: LookName;
  from: string;
  to: string;
  pairs: string[];
};

export type ContrastResult = {
  /** The kit to render with: the same object when nothing was shaded. */
  kit: RenderKit;
  warnings: ContrastWarning[];
  /** Pairs still under their limit: no colour of the kit could be shaded to fix them. */
  failures: PairResult[];
};

/** Shading one colour can move another pair; a few rounds settle it, and what is left over is reported as a failure. */
const MAX_ROUNDS = 6;

const asKitColour = (colour: Backdrop): KitColour | null =>
  typeof colour === 'string' || 'extra' in colour ? colour : null;

const labelOf = (colour: KitColour): string =>
  typeof colour === 'string' ? colour : `extras[${String(colour.extra)}]`;

/** The kit colour to shade for a failing pair: its text colour, else its background; null when both are fixed or a photo. */
function shadeTarget(pair: TextPair): { colour: KitColour; side: 'text' | 'on' } | null {
  const text = asKitColour(pair.text);
  if (text !== null) return { colour: text, side: 'text' };
  const on = asKitColour(pair.on);
  return on === null ? null : { colour: on, side: 'on' };
}

function withColour(kit: RenderKit, colour: KitColour, hex: string): RenderKit {
  if (typeof colour === 'string') return { ...kit, colors: { ...kit.colors, [colour]: hex } };
  const extras = kit.colors.extras.map((value, i) => (i === colour.extra ? hex : value));
  return { ...kit, colors: { ...kit.colors, extras } };
}

/** Every pair of every registered layout, at every size. */
const registeredPairs = (kit: RenderKit, look: LookName): TextPair[] =>
  registeredLayouts().flatMap((layout) =>
    SIZE_NAMES.flatMap((size) => pairsFor(layout, kit, look, size)),
  );

/**
 * Checks `pairs` (default: all pairs of the registered layouts, at every size) on the kit, and shades what fails:
 * the pair's text colour when it is a kit colour, otherwise its background colour. A fixed colour (`{ hex }`) and a
 * photo are never shaded. Returns the shaded kit (the same object when nothing failed), a warning for each colour
 * that changed, and the failures no shading could fix. The kit passed in is never changed.
 */
export function applyContrast(
  kit: RenderKit,
  look: LookName,
  pairs: readonly TextPair[] = registeredPairs(kit, look),
): ContrastResult {
  let current = kit;
  const changes = new Map<string, { from: string; to: string; pairs: Set<string> }>();
  // The pairs that fail on the kit as given, by the colour that would be shaded for them: a warning names them all,
  // also those another shade of the same colour fixed on the way.
  const failedAtStart = checkPairs(kit, look, pairs).flatMap((result, i) => {
    const pair = pairs[i];
    const target = pair === undefined || result.passes ? null : shadeTarget(pair);
    return pair !== undefined && target !== null
      ? [{ name: pair.name, colour: labelOf(target.colour) }]
      : [];
  });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const pair of pairs) {
      // Judged on the kit as it is now: an earlier shade may already have fixed this pair.
      const [result] = checkPairs(current, look, [pair]);
      if (result === undefined || result.passes) continue;

      const target = shadeTarget(pair);
      if (target === null) continue;
      const { colour, side } = target;
      const shaded =
        side === 'text'
          ? shadeToPass(result.text, result.on, result.limit)
          : shadeToPass(result.on, result.text, result.limit);
      const before = resolveColour(current, colour);
      if (shaded === null || shaded === before) continue;

      current = withColour(current, colour, shaded);
      const label = labelOf(colour);
      const change = changes.get(label) ?? { from: before, to: before, pairs: new Set<string>() };
      change.to = shaded;
      for (const name of failedAtStart.filter((f) => f.colour === label).map((f) => f.name)) {
        change.pairs.add(name);
      }
      change.pairs.add(pair.name);
      changes.set(label, change);
      changed = true;
    }
    if (!changed) break;
  }

  return {
    kit: changes.size === 0 ? kit : current,
    warnings: [...changes].map(([colour, { from, to, pairs: names }]) => ({
      colour,
      look,
      from,
      to,
      pairs: [...names],
    })),
    failures: checkPairs(current, look, pairs).filter((result) => !result.passes),
  };
}
