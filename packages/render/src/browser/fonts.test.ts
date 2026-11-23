import { describe, expect, it } from 'vitest';
import { fallbacks, fontLoadFailure, textBlocks, type DomNode } from './fonts.ts';

let next = 1;
const text = (value: string): DomNode => ({ nodeId: next++, nodeType: 3, nodeValue: value });
const el = (localName: string, attributes: string[], ...children: DomNode[]): DomNode => ({
  nodeId: next++,
  nodeType: 1,
  localName,
  attributes,
  children,
});

describe('textBlocks: the elements that hold text of their own', () => {
  const title = el('h1', ['class', 'title big'], text('ফিরে এল '), el('em', [], text('পিঠা')));
  const doc: DomNode = {
    nodeId: 0,
    nodeType: 9,
    children: [
      el(
        'html',
        ['lang', 'bn'],
        el('head', [], el('title', [], text('alt text')), el('style', [], text('p{}'))),
        el(
          'body',
          ['class', 'look-clean'],
          el('main', ['id', 'slide'], title, el('p', [], text('   \n  ')), el('p', [], text('Body'))),
          el('script', [], text('/* fit */')),
        ),
      ),
    ],
  };

  it('finds each block under the body in page order, named by its path, and skips scripts, styles and blank text', () => {
    expect(textBlocks(doc).map(({ block }) => block)).toEqual([
      'main#slide > h1.title.big',
      'main#slide > h1.title.big > em',
      'main#slide > p',
    ]);
    expect(textBlocks(doc)[0]?.nodeId).toBe(title.nodeId);
  });

  it('finds nothing in a page with no body', () => {
    expect(textBlocks({ nodeId: 0, nodeType: 9, children: [] })).toEqual([]);
  });
});

describe('fallbacks: a font the page didn’t ask for is an error', () => {
  it('names a system font that drew any glyph, such as Bangla in a Latin-only font or a missing glyph', () => {
    const errors = fallbacks([
      {
        block: 'main > h1',
        fonts: [
          { family: 'Nunito', custom: true, glyphs: 4 },
          { family: 'Noto Sans Bengali', custom: false, glyphs: 6 },
        ],
      },
      { block: 'main > p', fonts: [{ family: 'Hind Siliguri', custom: true, glyphs: 30 }] },
      { block: 'main > small', fonts: [{ family: 'DejaVu Sans', custom: false, glyphs: 1 }] },
    ]);
    expect(errors).toEqual([
      {
        code: 'font-fallback',
        block: 'main > h1',
        family: 'Noto Sans Bengali',
        glyphs: 6,
        message: 'main > h1: 6 glyphs were drawn by "Noto Sans Bengali", a font the page didn’t load',
      },
      {
        code: 'font-fallback',
        block: 'main > small',
        family: 'DejaVu Sans',
        glyphs: 1,
        message: 'main > small: 1 glyph was drawn by "DejaVu Sans", a font the page didn’t load',
      },
    ]);
  });

  it('has nothing to say when every glyph came from the page’s own fonts', () => {
    expect(
      fallbacks([{ block: 'p', fonts: [{ family: 'Nunito', custom: true, glyphs: 12 }] }]),
    ).toEqual([]);
    expect(fallbacks([])).toEqual([]);
  });
});

describe('fontLoadFailure: a font that fails to load fails the render, by name', () => {
  it('names each font that failed, without the CSS quotes', () => {
    expect(
      fontLoadFailure([
        { family: '"Hind Siliguri"', weight: '700' },
        { family: 'Nunito', weight: '400' },
      ]),
    ).toBe(
      'The font "Hind Siliguri" (weight 700) didn’t load; the font "Nunito" (weight 400) didn’t load',
    );
  });

  it('is undefined when every font loaded', () => {
    expect(fontLoadFailure([])).toBeUndefined();
  });
});
