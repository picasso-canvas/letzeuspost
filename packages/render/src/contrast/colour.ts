// Colour maths for the contrast check (§07, §08): WCAG 2.x relative luminance and contrast ratio, on `#rrggbb`.

export type Rgb = readonly [number, number, number];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb` (either case) to its three channels, 0–255. Anything else throws: the kit schema only lets this form in. */
export function parseHex(hex: string): Rgb {
  if (!HEX.test(hex)) throw new Error(`"${hex}" is not a six-digit hex colour`);
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Channels (rounded and clamped to 0–255) to lower-case `#rrggbb`. */
export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((v) =>
      Math.min(255, Math.max(0, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** WCAG 2.x relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as unknown as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 to 21; the same whichever colour is the text. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
