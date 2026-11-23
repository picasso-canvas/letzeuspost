import { contrastRatio, parseHex, toHex } from './colour.ts';

// Auto-shading: the nearest darker or lighter shade of a colour that passes a contrast limit (§07, §08).

/** How far the lightness moves per try. Finer than one step of an 8-bit channel, so no passing hex value is skipped. */
const STEP = 0.001;

type Hsl = { h: number; s: number; l: number };

function toHsl(hex: string): Hsl {
  const [r, g, b] = parseHex(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function fromHsl({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector] as readonly [number, number, number];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/**
 * The nearest shade of `colour` (same hue and saturation, lighter or darker) that reaches `limit` against `against`:
 * the colour itself when it already does. `null` when not even black or white of that hue can (a limit above what the
 * background allows). Colours are `#rrggbb`; the result is lower-case.
 */
export function shadeToPass(colour: string, against: string, limit: number): string | null {
  const original = toHex(parseHex(colour));
  if (contrastRatio(original, against) >= limit) return original;
  const start = toHsl(original);
  const steps = Math.ceil(1 / STEP);
  for (let i = 1; i <= steps; i++) {
    const candidates = [start.l - i * STEP, start.l + i * STEP]
      .filter((l) => l >= 0 && l <= 1)
      .map((l) => fromHsl({ ...start, l }))
      .filter((hex) => contrastRatio(hex, against) >= limit);
    // Both directions can pass at the same distance: take the one with more contrast.
    const best = candidates.sort(
      (a, b) => contrastRatio(b, against) - contrastRatio(a, against),
    )[0];
    if (best !== undefined) return best;
  }
  return null;
}
