import type { Post, Slide, SizeName } from '@lzp/core';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderLayout } from '../layouts/index.ts';
import { RenderKitSchema, type RenderKit } from '../kit.ts';
import { SIZES } from '../sizes.ts';
import type { BuildContext, BuildWarning } from './assets.ts';
import { BASE_CSS, sizeCss } from './base-css.ts';
import { contentPolicy } from './content-policy.ts';
import { FIT_SCRIPT } from './fit-script.ts';
import { getLook } from './looks.ts';
import { sha256Base64 } from './sha256.ts';
import { resolveSwitches, switchClasses } from './switches.ts';
import { themeCss } from './theme.ts';

// The one HTML builder (§08): the editor's preview and the worker's render both call it, so it has no server-only code
// and no clock, random number or network: the same input is the same string, byte for byte.

export type BuildResult = { html: string; warnings: BuildWarning[] };

/**
 * One slide as a full HTML document: the layout, the base CSS, the look's CSS, the brand's tokens as CSS variables, the
 * fonts and the fit script, under a content policy that allows only that script (by its hash), that one style (by its
 * hash) and images and fonts from the job's own asset scheme.
 *
 * Throws for what is a bug in the caller, not in the content: a look that isn't registered, a switch value or a colour
 * or font name that the schemas refuse, a layout that isn't built yet. Content problems (an image that isn't an asset)
 * come back as warnings.
 */
export function buildSlideWithWarnings(
  post: Post,
  slide: Slide,
  size: SizeName,
  kit: RenderKit,
): BuildResult {
  const { name, switches } = resolveSwitches(post.look, size);
  const look = getLook(name);
  if (look === undefined) throw new Error(`The look "${name}" isn't registered`);
  // The colours and fonts go into CSS: check them here (asset keys are checked where an image is drawn, as warnings).
  const checked = {
    ...kit,
    colors: RenderKitSchema.shape.colors.parse(kit.colors),
    fonts: RenderKitSchema.shape.fonts.parse(kit.fonts),
  };

  const context: BuildContext = { warnings: [] };
  const main = renderLayout({ post, slide, size, kit: checked, switches, context });

  const style = [themeCss(checked, post.lang, look), BASE_CSS, sizeCss(size), look.css].join('\n');
  const classes = [
    `look-${name}`,
    `size-${size}`,
    SIZES[size].arrangement === 'columns' ? 'cols' : 'stack',
    ...switchClasses(switches),
  ];

  const document = h(
    'html',
    { lang: post.lang },
    h(
      'head',
      null,
      h('meta', { charSet: 'utf-8' }),
      h('meta', {
        httpEquiv: 'Content-Security-Policy',
        content: contentPolicy(sha256Base64(FIT_SCRIPT), sha256Base64(style)),
      }),
      h('title', null, slide.alt),
      h('style', null, style),
    ),
    h('body', { className: classes.join(' ') }, main, h('script', null, FIT_SCRIPT)),
  );
  return { html: `<!DOCTYPE html>${renderToStaticMarkup(document)}`, warnings: context.warnings };
}

/** `buildSlide(post, slide, size, kit)`: the HTML page of one slide (§08). `buildSlideWithWarnings` also returns what it left out. */
export const buildSlide = (post: Post, slide: Slide, size: SizeName, kit: RenderKit): string =>
  buildSlideWithWarnings(post, slide, size, kit).html;
