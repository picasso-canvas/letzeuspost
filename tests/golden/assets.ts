import type { RenderAsset } from '../../packages/render/src/browser/index.ts';
import { SAMPLE_BRANDS, type BrandId } from './brands.ts';

// The sample brands' logos, photos and mascot, drawn in code as SVG (§17: no real brand, no copyrighted art; photos
// are generated placeholders). Shapes only: an SVG's text would be drawn in whatever font the system has, so a logo's
// "name" is a row of bars. Every drawing is a fixed string, so the bytes, and the renders, are the same on every run.

/** The key of every brand's placeholder photo; a slide's `image` names it. */
export const PHOTO = 'photo_1';

const svg = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`;

/** Five petals around a centre, turned by `turn` degrees: Kathgolap's frangipani. */
function flower(cx: number, cy: number, petal: string, centre: string): string {
  const petals = [0, 72, 144, 216, 288]
    .map(
      (turn) =>
        `<ellipse cx="${String(cx)}" cy="${String(cy - 34)}" rx="22" ry="38" fill="${petal}" transform="rotate(${String(turn)} ${String(cx)} ${String(cy)})"/>`,
    )
    .join('');
  return `${petals}<circle cx="${String(cx)}" cy="${String(cy)}" r="14" fill="${centre}"/>`;
}

/** A wordmark without letters: bars of different lengths, the brand's name as the logo's shape. */
const bars = (x: number, colour: string, lengths: readonly number[]): string =>
  lengths
    .map(
      (length, i) =>
        `<rect x="${String(x)}" y="${String(52 + i * 34)}" width="${String(length)}" height="20" rx="10" fill="${colour}"/>`,
    )
    .join('');

/** Three waves under a drop: Tidewell's mark. */
const waves = (colour: string, drop: string): string =>
  `<path d="M80 22 C104 60 120 78 120 98 A40 40 0 0 1 40 98 C40 78 56 60 80 22 Z" fill="${drop}"/>` +
  [0, 1, 2]
    .map(
      (i) =>
        `<path d="M14 ${String(126 + i * 10)} q16 -12 33 0 t33 0 t33 0 t33 0" fill="none" stroke="${colour}" stroke-width="6" stroke-linecap="round"/>`,
    )
    .join('');

/** A wheel with eight spokes: Chaka's mark. */
function wheel(cx: number, cy: number, r: number, rim: string, hub: string): string {
  const spokes = [0, 45, 90, 135]
    .map(
      (turn) =>
        `<rect x="${String(cx - 3)}" y="${String(cy - r)}" width="6" height="${String(2 * r)}" fill="${rim}" transform="rotate(${String(turn)} ${String(cx)} ${String(cy)})"/>`,
    )
    .join('');
  return `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}" fill="none" stroke="${rim}" stroke-width="12"/>${spokes}<circle cx="${String(cx)}" cy="${String(cy)}" r="14" fill="${hub}"/>`;
}

/** Each brand's logo, for a light background and for a dark one. */
function logos(brand: BrandId): { light: string; dark: string } {
  const { primary, accent, ink } = SAMPLE_BRANDS[brand].kit.colors;
  const draw = (mark: string, name: string, lengths: readonly number[]) =>
    svg(480, 160, `${mark}${bars(170, name, lengths)}`);
  switch (brand) {
    case 'kathgolap':
      return {
        light: draw(flower(80, 80, primary, accent), ink, [280, 200]),
        dark: draw(flower(80, 80, '#ffffff', accent), '#ffffff', [280, 200]),
      };
    case 'tidewell':
      return {
        light: draw(waves(accent, primary), primary, [250, 160, 210]),
        dark: draw(waves(accent, '#ffffff'), '#ffffff', [250, 160, 210]),
      };
    case 'chaka':
      return {
        light: draw(wheel(80, 80, 62, ink, primary), ink, [300, 140]),
        dark: draw(wheel(80, 80, 62, '#ffffff', accent), '#ffffff', [300, 140]),
      };
  }
}

/** A placeholder photo in the brand's colours: a sky, a sun and two hills, 1600 × 1200. */
function photo(brand: BrandId): string {
  const { primary, accent, background, extras } = SAMPLE_BRANDS[brand].kit.colors;
  const far = extras[0] ?? accent;
  return svg(
    1600,
    1200,
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${background}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>` +
      `<rect width="1600" height="1200" fill="url(#sky)"/>` +
      `<circle cx="1180" cy="360" r="150" fill="${accent}"/>` +
      `<path d="M0 820 C300 640 620 640 900 780 C1160 900 1380 760 1600 700 L1600 1200 L0 1200 Z" fill="${far}"/>` +
      `<path d="M0 980 C360 840 760 880 1040 960 C1260 1020 1440 980 1600 940 L1600 1200 L0 1200 Z" fill="${primary}"/>`,
  );
}

/** Chaka's mascot: a round, friendly bicycle bell with eyes. */
function mascot(brand: BrandId): string {
  const { primary, accent, ink } = SAMPLE_BRANDS[brand].kit.colors;
  return svg(
    400,
    400,
    `<rect x="186" y="40" width="28" height="60" rx="14" fill="${ink}"/>` +
      `<path d="M60 300 C60 150 120 90 200 90 C280 90 340 150 340 300 Z" fill="${accent}"/>` +
      `<rect x="40" y="292" width="320" height="40" rx="20" fill="${primary}"/>` +
      `<circle cx="160" cy="200" r="18" fill="${ink}"/><circle cx="240" cy="200" r="18" fill="${ink}"/>` +
      `<path d="M160 250 Q200 280 240 250" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>`,
  );
}

const asset = (key: string, drawing: string): RenderAsset => ({
  kind: 'image',
  key,
  contentType: 'image/svg+xml',
  data: Buffer.from(drawing, 'utf8'),
});

/** The brand's assets as the render job would be given them: its logos, its photo and its mascot when it has one. */
export function brandAssets(brand: BrandId): RenderAsset[] {
  const { kit } = SAMPLE_BRANDS[brand];
  const logo = logos(brand);
  const assets = [
    asset(kit.logo.light, logo.light),
    asset(kit.logo.dark, logo.dark),
    asset(PHOTO, photo(brand)),
  ];
  return kit.mascot === undefined ? assets : [...assets, asset(kit.mascot, mascot(brand))];
}
