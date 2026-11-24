import {
  SIZE_NAMES,
  type LayoutName,
  type LookName,
  type Post,
  type SizeName,
  type Slide,
} from '../../packages/core/src/index.ts';
import type { RenderAsset } from '../../packages/render/src/browser/index.ts';
import type { ContrastResult } from '../../packages/render/src/contrast/apply.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import { cleanContrast } from '../../packages/render/src/looks/clean/contrast.ts';
import { playfulContrast } from '../../packages/render/src/looks/playful/contrast.ts';
import { brandAssets } from './assets.ts';
import { FAILING_COLORS, SAMPLE_BRANDS, type BrandId } from './brands.ts';
import {
  CONJUNCTS,
  NO_BANGLA_FONT,
  SAMPLES,
  longest,
  sampleSlide,
  type LaunchSamples,
} from './content.ts';

// The golden-render matrix (§08 Golden renders, §17, §18), as data: every launch layout × size × look × language, with
// sample content from the brand each layout belongs to, plus the hard cases. golden.spec.ts renders each case.
//
// At launch the matrix is 10 layouts × 5 sizes × 2 looks × 2 languages = 200 cases (§18). The full set is
// `casesFor(LAYOUT_NAMES, LOOK_NAMES)`, 14 × 5 × 4 × 2 = 560: when M8 adds testimonial, photocard, meme and beforeafter
// and the Bold and Editorial looks, each new layout gets its sample in `content.ts` and its brand in `BRAND_OF`, and
// `LAUNCH_LAYOUTS` and `LAUNCH_LOOKS` grow to the full lists. Nothing else changes.

export const LANGS = ['en', 'bn'] as const;
export type Lang = (typeof LANGS)[number];

/** The layouts the renderer draws at launch, in §07's order. */
export const LAUNCH_LAYOUTS = [
  'cover',
  'fact',
  'step',
  'list',
  'quote',
  'stat',
  'question',
  'offer',
  'cta',
  'text',
] as const satisfies readonly (keyof LaunchSamples)[];
type LaunchLayout = (typeof LAUNCH_LAYOUTS)[number];

/** The looks built at launch (§18); Bold and Editorial follow in M8. */
export const LAUNCH_LOOKS = ['clean', 'playful'] as const satisfies readonly LookName[];
type LaunchLook = (typeof LAUNCH_LOOKS)[number];

/** Which sample brand each layout's content comes from: each brand gets three or four layouts, so each is seen at every size, look and language. */
const BRAND_OF: Record<LayoutName, BrandId> = {
  cover: 'kathgolap',
  fact: 'tidewell',
  step: 'chaka',
  list: 'kathgolap',
  quote: 'tidewell',
  stat: 'chaka',
  question: 'kathgolap',
  offer: 'tidewell',
  cta: 'chaka',
  text: 'kathgolap',
  // M8
  testimonial: 'tidewell',
  photocard: 'chaka',
  meme: 'chaka',
  beforeafter: 'tidewell',
};

/** What a hard case tests: the longest allowed text, Bangla conjuncts, a missing image, a font with no Bangla, a palette that fails contrast. */
export type HardKind = 'longest' | 'conjuncts' | 'missing-image' | 'no-bangla-font' | 'contrast';

export type GoldenCase = {
  /** The image's name: `<layout>-<size>-<look>-<lang>`, a hard case's with `hard-<kind>-` in front. */
  id: string;
  layout: LayoutName;
  size: SizeName;
  look: LookName;
  lang: Lang;
  brand: BrandId;
  hard?: HardKind;
};

function goldenCase(
  layout: LayoutName,
  size: SizeName,
  look: LookName,
  lang: Lang,
  hard?: HardKind,
): GoldenCase {
  const id = `${layout}-${size}-${look}-${lang}`;
  const base = { layout, size, look, lang, brand: BRAND_OF[layout] };
  return hard === undefined ? { id, ...base } : { id: `hard-${hard}-${id}`, ...base, hard };
}

/** Every layout × size × look × language of the lists given: the launch matrix, or the full one (560) once M8 lands. */
export function casesFor(layouts: readonly LayoutName[], looks: readonly LookName[]): GoldenCase[] {
  return layouts.flatMap((layout) =>
    SIZE_NAMES.flatMap((size) =>
      looks.flatMap((look) => LANGS.map((lang) => goldenCase(layout, size, look, lang))),
    ),
  );
}

/** The 200 launch cases. */
export const LAUNCH_CASES: GoldenCase[] = casesFor(LAUNCH_LAYOUTS, LAUNCH_LOOKS);

const eachLook = <T>(fn: (look: LaunchLook) => T[]): T[] => LAUNCH_LOOKS.flatMap(fn);
const eachLang = <T>(fn: (lang: Lang) => T[]): T[] => LANGS.flatMap(fn);

/**
 * The hard cases (§08), each in both launch looks:
 * - the longest allowed text in every field of every launch layout, in both languages, at landscape (the size with
 *   the least room);
 * - Bangla full of conjuncts, ya-phala and reph at every size;
 * - a cover whose photo isn't among the job's assets, in both languages;
 * - an English cover with Bangla in it, in a kit whose English fonts have no Bangla;
 * - a cover in a palette that fails contrast, in both languages.
 */
export const HARD_CASES: GoldenCase[] = [
  ...LAUNCH_LAYOUTS.flatMap((layout) =>
    eachLook((look) =>
      eachLang((lang) => [goldenCase(layout, 'landscape', look, lang, 'longest')]),
    ),
  ),
  ...SIZE_NAMES.flatMap((size) =>
    eachLook((look) => [goldenCase('text', size, look, 'bn', 'conjuncts')]),
  ),
  ...eachLook((look) =>
    eachLang((lang) => [goldenCase('cover', 'portrait', look, lang, 'missing-image')]),
  ),
  ...eachLook((look) => [goldenCase('cover', 'portrait', look, 'en', 'no-bangla-font')]),
  ...eachLook((look) =>
    eachLang((lang) => [goldenCase('cover', 'portrait', look, lang, 'contrast')]),
  ),
];

/** Every case golden.spec.ts renders: the launch matrix, then the hard cases. */
export const GOLDEN_CASES: GoldenCase[] = [...LAUNCH_CASES, ...HARD_CASES];

/** A photo key that no job's assets hold. */
export const MISSING_PHOTO = 'photo_missing';

export type CaseInput = {
  /** A carousel with the case's slide twice, so the page number is drawn as it is on a real carousel. */
  post: Post;
  /** The kit to render with: the brand's, after the look's contrast check (shaded when it failed). */
  kit: RenderKit;
  contrast: ContrastResult;
  assets: RenderAsset[];
  expected: {
    /** The render reports a fallback font (the no-Bangla-font case only). */
    fontFallback: boolean;
    /** The asset keys whose requests are blocked (the missing-image case only). */
    blocked: string[];
    /** The look's contrast check shaded the kit and warned (the failing-palette case only). */
    contrastShaded: boolean;
  };
};

const CONTRAST: Record<LaunchLook, (kit: RenderKit) => ContrastResult> = {
  clean: cleanContrast,
  playful: playfulContrast,
};

const isLaunchLayout = (layout: LayoutName): layout is LaunchLayout =>
  (LAUNCH_LAYOUTS as readonly LayoutName[]).includes(layout);
const isLaunchLook = (look: LookName): look is LaunchLook =>
  (LAUNCH_LOOKS as readonly LookName[]).includes(look);

function slideOf(golden: GoldenCase): Slide {
  const { layout, lang } = golden;
  if (!isLaunchLayout(layout))
    throw new Error(`${layout} has no sample content yet (M8: add it to content.ts)`);
  switch (golden.hard) {
    case 'longest':
      return longest(sampleSlide(layout, lang), lang);
    case 'conjuncts':
      return CONJUNCTS;
    case 'missing-image':
      return { ...SAMPLES.cover[lang], image: { asset: MISSING_PHOTO } };
    case 'no-bangla-font':
      return NO_BANGLA_FONT;
    case 'contrast':
    case undefined:
      return sampleSlide(layout, lang);
  }
}

/** Everything a case renders from, and what its render is expected to report. */
export function caseInput(golden: GoldenCase): CaseInput {
  const { look, lang, brand, hard } = golden;
  if (!isLaunchLook(look)) throw new Error(`${look} isn't built yet (M8)`);
  const slide = slideOf(golden);
  const post: Post = {
    brand,
    lang,
    kind: 'carousel',
    networks: ['instagram'],
    date: '2026-12-14T12:30:00+06:00',
    look: { name: look, switches: {} },
    slides: [slide, slide],
    captions: {},
    flags: { aiImage: false, claimsConfirmed: null, testimonialConsent: null },
  };
  const brandKit = SAMPLE_BRANDS[brand].kit;
  const contrast = CONTRAST[look](
    hard === 'contrast' ? { ...brandKit, colors: FAILING_COLORS } : brandKit,
  );
  return {
    post,
    kit: contrast.kit,
    contrast,
    assets: brandAssets(brand),
    expected: {
      fontFallback: hard === 'no-bangla-font',
      blocked: hard === 'missing-image' ? [MISSING_PHOTO] : [],
      contrastShaded: hard === 'contrast',
    },
  };
}
