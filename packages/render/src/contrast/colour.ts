// Colour maths for the contrast check (§07, §08): WCAG 2.x relative luminance and contrast ratio, on `#rrggbb`.

export type Rgb = readonly [number, number, number];

export function parseHex(_hex: string): Rgb {
  throw new Error('not implemented');
}

export function toHex(_rgb: Rgb): string {
  throw new Error('not implemented');
}

export function relativeLuminance(_hex: string): number {
  throw new Error('not implemented');
}

export function contrastRatio(_a: string, _b: string): number {
  throw new Error('not implemented');
}
