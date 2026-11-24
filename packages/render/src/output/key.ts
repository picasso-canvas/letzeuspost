import { createHash } from 'node:crypto';
import type { Post } from '@lzp/core';
import { FONT_MANIFEST } from '../fonts/library.ts';
import type { RenderKit } from '../kit.ts';
import type { SizeName } from '../sizes.ts';

// The cache key of a rendered file (§08 When renders happen, and caching): "a hash of the renderer version, look
// version, the brand's tokens and fonts, the slide content, the image assets with their crops, the size and the
// format". The same key reuses the stored file. Each of those is taken as exactly what the page draws from it, and
// nothing else of the post or the kit goes in, so a change the page can't show (a caption, the date) keeps the file.

/** The render code's version: raise it whenever a change to the renderer can change a rendered file. */
export const RENDERER_VERSION = 1;

export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'pdf'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** An image the page draws (a photo, a logo, the mascot): its asset key and the sha256 of its bytes (§13 `asset`). */
export type KeyAsset = { key: string; sha256: string };

type Common = {
  /** `RENDERER_VERSION`, as the render that made the file had it. */
  rendererVersion: number;
  /** The version of the post's look, as it is registered (`LookDefinition.version`). */
  lookVersion: number;
  kit: RenderKit;
  post: Post;
  /** The images the page draws; for a PDF, the copies it uses (1600 px photos). */
  assets: readonly KeyAsset[];
  size: SizeName;
};

/** An image (the PNG master, the JPEG, the WebP thumbnail) is one slide. */
export type ImageKeyInput = Common & {
  format: Exclude<OutputFormat, 'pdf'>;
  /** The slide, from 0. */
  slide: number;
};

/** The PDF is every slide, titled with the hook. */
export type DocumentKeyInput = Common & {
  format: 'pdf';
  /** The post's hook, the PDF's title (§12). */
  title: string;
};

export type RenderKeyInput = ImageKeyInput | DocumentKeyInput;

/** By UTF-16 code units, the same on every machine (no locale). */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** JSON with every object's keys in order, so the same value is the same text however it was built. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => byText(a, b));
    return `{${entries.map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The font files of one family in the manifest, by their sha256: a new file for the same name is a new font. */
function fontFiles(family: string, language: Post['lang']): string[] {
  const font = FONT_MANIFEST.fonts.find(
    (candidate) => candidate.family === family && candidate.languages.includes(language),
  );
  if (font === undefined) throw new Error(`"${family}" is not a ${language} font in the manifest`);
  return font.files.map((file) => file.sha256).sort(byText);
}

/** The slide content the page draws: the slide, its place and the slide count (its page number), the language and the look. */
function content(input: RenderKeyInput): unknown {
  const { post } = input;
  const shared = { lang: post.lang, look: post.look };
  if (input.format === 'pdf') return { ...shared, slides: post.slides, title: input.title };
  const slide = post.slides[input.slide];
  if (!Number.isInteger(input.slide) || slide === undefined)
    throw new Error(`The post has no slide ${String(input.slide)}`);
  return { ...shared, slide, index: input.slide, count: post.slides.length };
}

/** The cache key of one rendered file: a sha256, in hex, over exactly the inputs §08 lists. Pure: no clock, no I/O. */
export function renderKey(input: RenderKeyInput): string {
  const { kit, post } = input;
  const fonts = kit.fonts[post.lang];
  const key = {
    renderer: input.rendererVersion,
    look: input.lookVersion,
    brand: {
      tokens: { colors: kit.colors, logo: kit.logo, mascot: kit.mascot },
      fonts: {
        heading: { family: fonts.heading, files: fontFiles(fonts.heading, post.lang) },
        body: { family: fonts.body, files: fontFiles(fonts.body, post.lang) },
      },
    },
    content: content(input),
    assets: input.assets
      .map(({ key: asset, sha256 }) => ({ key: asset, sha256 }))
      .sort((a, b) => byText(canonical(a), canonical(b))),
    size: input.size,
    format: input.format,
  };
  return createHash('sha256').update(canonical(key)).digest('hex');
}
