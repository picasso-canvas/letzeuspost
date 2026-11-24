import type { Post } from '@lzp/core';
import { Fragment, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIT_SCRIPT } from '../fit/script.ts';
import type { FitReport } from '../fit/report.ts';
import type { RenderKit } from '../kit.ts';
import { buildSlideWithWarnings } from '../page/build-slide.ts';
import { sha256Base64 } from '../page/sha256.ts';
import { SIZES, type SizeName } from '../sizes.ts';

// The LinkedIn PDF's HTML (§08 Outputs, §12 LinkedIn carousel PDF): all of a post's slides in one document, one page
// each, "printed from the same HTML as the images". Each page is the slide's own page from `buildSlide`: its `<main>`
// under the same style and body classes (the style, the look and the switches are the post's, so every slide shares
// them), at the `--k` its image render settled on, taken from its fit report, so the pages match the JPEGs. The fit
// script doesn't run here: the scale is already known, and the document runs no script at all.

export type DocumentInput = {
  post: Post;
  /** The one size every page has (LinkedIn needs them all the same). */
  size: SizeName;
  kit: RenderKit;
  /** Each slide's fit report from its image render at `size`, in slide order. */
  reports: readonly FitReport[];
  /** The post's hook: the PDF's title (§12). */
  title: string;
};

// The page `buildSlide` writes: its head (React's image preloads, the policy, the slide's alt text as the title), its
// one style, its body classes, the slide's `<main>` and the fit script last.
const PAGE =
  /^<!DOCTYPE html><html lang="([a-z]+)"><head>([\s\S]*?)<style>([\s\S]*?)<\/style><\/head><body class="([^"]*)">([\s\S]*)<\/body><\/html>$/;
const POLICY = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/;
const SCRIPT = `<script>${FIT_SCRIPT}</script>`;

type SlidePage = { lang: string; policy: string; style: string; classes: string; main: string };

/** The parts of a page `buildSlide` made; anything else is a change to the builder this must follow. */
function slidePage(html: string): SlidePage {
  const [, lang, head, style, classes, body] = PAGE.exec(html) ?? [];
  // React writes the policy's quotes as `&#x27;`; it holds no other character that is escaped.
  const policy = POLICY.exec(head ?? '')?.[1]?.replaceAll('&#x27;', "'");
  if (
    lang === undefined ||
    policy === undefined ||
    policy.includes('&') ||
    style === undefined ||
    classes === undefined ||
    body?.endsWith(SCRIPT) !== true
  )
    throw new Error('The slide page is not one buildSlide makes');
  return { lang, policy, style, classes, main: body.slice(0, -SCRIPT.length) };
}

/** The page's own policy, with no script allowed and the document's style by its hash. */
function documentPolicy(policy: string, style: string): string {
  const directives = policy.split('; ').filter((directive) => !directive.startsWith('script-src '));
  const styles = directives.filter((directive) => directive.startsWith('style-src '));
  if (styles.length !== 1) throw new Error('The slide page’s policy has no single style-src');
  return directives
    .map((directive) =>
      directive.startsWith('style-src ') ? `style-src 'sha256-${sha256Base64(style)}'` : directive,
    )
    .join('; ');
}

/** Pages at the slide's size with no margins; the body grows to hold them all; each page keeps its slide's `--k`. */
function printCss(size: SizeName, reports: readonly FitReport[]): string {
  const { width, height } = SIZES[size];
  return `
@page { size: ${String(width)}px ${String(height)}px; margin: 0; }
body { height: auto; overflow: visible; }
.pdf-page {
  display: block;
  width: var(--w);
  height: var(--h);
  overflow: hidden;
  break-after: page;
  break-inside: avoid;
}
.pdf-page:last-child { break-after: auto; }
${reports.map((report) => `.pdf-page-${String(report.slide)} { --k: ${String(report.k)}; }`).join('\n')}
`;
}

/**
 * The LinkedIn PDF's page: every slide of `post` at `size`, one page each, at the `k` of its fit report, titled with
 * the hook. Throws when the reports aren't one per slide, in order, at `size`, or the title is empty (LinkedIn asks for
 * one).
 */
export function buildDocument(input: DocumentInput): string {
  const { post, size, kit, reports, title } = input;
  if (post.slides.length === 0) throw new Error('A PDF needs slides; this post has none');
  if (
    reports.length !== post.slides.length ||
    reports.some((report, index) => report.slide !== index + 1 || report.size !== size)
  )
    throw new Error(`A PDF needs each slide’s fit report at ${size}, one per slide, in order`);
  if (title.trim() === '') throw new Error('A PDF needs a title (the post’s hook)');

  const pages = post.slides.map((slide) =>
    slidePage(buildSlideWithWarnings(post, slide, size, kit).html),
  );
  const [first] = pages;
  if (first === undefined) throw new Error('A PDF needs slides; this post has none');
  if (pages.some((page) => page.style !== first.style || page.classes !== first.classes))
    throw new Error('The slides of one post have different styles');

  const style = `${first.style}\n${printCss(size, reports)}`;
  const body = pages
    .map(
      (page, index) =>
        `<section class="pdf-page pdf-page-${String(index + 1)}">${page.main}</section>`,
    )
    .join('');
  // The head's attributes and title are written by React, so they are escaped as the slide pages' are; the style and
  // the pages are already the builder's own markup.
  const head = renderToStaticMarkup(
    h(
      Fragment,
      null,
      h('meta', { charSet: 'utf-8' }),
      h('meta', {
        httpEquiv: 'Content-Security-Policy',
        content: documentPolicy(first.policy, style),
      }),
      h('title', null, title),
    ),
  );
  return `<!DOCTYPE html><html lang="${first.lang}"><head>${head}<style>${style}</style></head><body class="${first.classes}">${body}</body></html>`;
}
