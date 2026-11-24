import type { RenderKit } from '../../packages/render/src/kit.ts';

// The three sample brands of the golden renders (§08 Golden renders, §17). All three are made up: no real business, no
// real person, no real logo. Their fonts are the font manifest's, their logos and photos are drawn in code
// (`assets.ts`). Each has its own palette and its own font pairing, so a change to how a kit reaches the page shows in
// some image: Kathgolap uses the Clean pair, Tidewell the Playful pair, Chaka mixes the two and has a mascot.

export const BRAND_IDS = ['kathgolap', 'tidewell', 'chaka'] as const;
export type BrandId = (typeof BRAND_IDS)[number];

export type SampleBrand = {
  /** The brand's name in each language, as it writes it itself. */
  name: { en: string; bn: string };
  /** What the brand is, for the reader of these tests. */
  about: string;
  kit: RenderKit;
};

/** Every brand's logo for light and dark backgrounds, under the same keys (`assets.ts` draws each brand's own). */
const logo = { light: 'logo_light', dark: 'logo_dark' };

export const SAMPLE_BRANDS: Record<BrandId, SampleBrand> = {
  kathgolap: {
    name: { en: 'Kathgolap Books', bn: 'কাঠগোলাপ বুকস' },
    about: 'A small bookshop and reading room in Dhaka.',
    kit: {
      colors: {
        primary: '#2f5d50',
        accent: '#e8a33d',
        background: '#fbf6ec',
        ink: '#1f2a24',
        extras: ['#c9563c'],
      },
      fonts: {
        en: { heading: 'Nunito', body: 'Nunito' },
        bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
      },
      logo,
    },
  },
  tidewell: {
    name: { en: 'Tidewell Dental', bn: 'টাইডওয়েল ডেন্টাল' },
    about: 'A family dental clinic.',
    kit: {
      colors: {
        primary: '#1f4e8c',
        accent: '#46b3a8',
        background: '#ffffff',
        ink: '#14213d',
        extras: [],
      },
      fonts: {
        en: { heading: 'Bagel Fat One', body: 'Baloo 2' },
        bn: { heading: 'Baloo Da 2', body: 'Baloo Da 2' },
      },
      logo,
    },
  },
  chaka: {
    name: { en: 'Chaka Cycle Works', bn: 'চাকা সাইকেল ওয়ার্কস' },
    about: 'A bicycle repair shop that runs weekend rides.',
    kit: {
      colors: {
        primary: '#b23a1e',
        accent: '#f4c430',
        background: '#fff7e6',
        ink: '#2b1d14',
        extras: ['#2f6f4e'],
      },
      fonts: {
        en: { heading: 'Baloo 2', body: 'Nunito' },
        bn: { heading: 'Baloo Da 2', body: 'Hind Siliguri' },
      },
      logo,
      mascot: 'mascot_1',
    },
  },
};

/**
 * A palette that fails contrast in both looks (the hard case): pale ink and a pale primary on white. The renderer
 * shades the failing colours and warns (§07 Contrast); the golden image is the shaded result.
 */
export const FAILING_COLORS: RenderKit['colors'] = {
  primary: '#f7d046',
  accent: '#a8e0d8',
  background: '#ffffff',
  ink: '#b0b0b0',
  extras: [],
};
