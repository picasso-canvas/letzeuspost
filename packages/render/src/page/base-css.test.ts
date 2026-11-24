import { describe, expect, it } from 'vitest';
import { FIT_SCRIPT, IMAGE_BOX_MIN_SHARE } from '../fit/script.ts';
import { BANGLA_LINE_HEIGHT_MIN } from '../fonts/manifest.ts';
import { SIZES } from '../sizes.ts';
import { BASE_CSS, QUOTE_TITLE_SHARE, sizeCss } from './base-css.ts';

// §07 and §08 on Bangla and on print-safe CSS, read off the CSS itself.

/** The declarations of every rule that has `selector` in its selector list. */
function declarations(css: string, selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors?.split(',').some((s) => s.trim() === selector))
    .map(([, , body]) => body)
    .join(';');
}

describe('the base CSS', () => {
  it('has no CSS filter, backdrop blur or blend mode (print-safe, §08)', () => {
    expect(BASE_CSS).not.toMatch(/filter/i);
    expect(BASE_CSS).not.toMatch(/blend/i);
    expect(BASE_CSS).not.toMatch(/backdrop/i);
    for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
      expect(sizeCss(size)).not.toMatch(/filter|blend|backdrop/i);
    }
  });

  it('has no letter-spacing, uppercase or italic (§07: Bangla)', () => {
    expect(BASE_CSS).not.toMatch(/letter-spacing\s*:\s*(?!0\b|normal)/i);
    expect(BASE_CSS).not.toMatch(/uppercase|capitalize/i);
    expect(BASE_CSS).not.toMatch(/italic|oblique/i);
  });

  it('turns hyphenation off', () => {
    expect(declarations(BASE_CSS, 'html')).toMatch(/hyphens:\s*none/);
    expect(BASE_CSS).not.toMatch(/hyphens:\s*(auto|manual)/);
  });

  it('balances headings, and keeps a lone word off the last line of body text (§08)', () => {
    expect(declarations(BASE_CSS, '.title')).toMatch(/text-wrap:\s*balance/);
    expect(declarations(BASE_CSS, '.body')).toMatch(/text-wrap:\s*pretty/);
  });

  it('takes line-heights from variables, which the page sets per language', () => {
    expect(declarations(BASE_CSS, '.body')).toMatch(/line-height:\s*var\(--lh-body\)/);
    expect(declarations(BASE_CSS, '.title')).toMatch(/line-height:\s*var\(--lh-heading\)/);
    expect(BASE_CSS).not.toMatch(/line-height:\s*[\d.]/);
  });

  it('writes page numbers with the numerals the page was given (Bangla digits come from the builder)', () => {
    expect(BASE_CSS).not.toMatch(/counter\(/); // CSS counters would print Latin digits
  });

  it('does not use the network: no url() at all, no @import', () => {
    expect(BASE_CSS).not.toMatch(/url\(|@import/i);
  });

  it('never lets the body fall below its floor, and gives small print a fixed 28 px', () => {
    expect(declarations(BASE_CSS, '.body')).toMatch(/font-size:\s*max\(var\(--body-floor\)/);
    expect(declarations(BASE_CSS, '.small-print')).toMatch(/font-size:\s*28px/);
    expect(declarations(BASE_CSS, '.page-number')).toMatch(/font-size:\s*28px|small-print/);
  });

  it('keeps an image box at 26% of the page height at least, and the fit script checks the same share', () => {
    expect(declarations(BASE_CSS, '.image-box')).toMatch(
      /min-height:\s*calc\(var\(--h\) \* 0\.26\)/,
    );
    expect(IMAGE_BOX_MIN_SHARE).toBe(0.26);
    expect(FIT_SCRIPT).toContain('const IMAGE_BOX_SHARE = 0.26;');
  });
});

describe('the rules of the cover, cta and step layouts (#338)', () => {
  it('crops a photo to its box instead of stretching it', () => {
    expect(declarations(BASE_CSS, 'img.photo')).toMatch(/object-fit:\s*cover/);
  });

  it('keeps the brand mark inside bounds and in its own shape', () => {
    const mark = declarations(BASE_CSS, '.cta-mark');
    expect(mark).toMatch(/object-fit:\s*contain/);
    expect(mark).toMatch(/max-width:\s*100%/);
    expect(mark).toMatch(/width:\s*auto/);
    expect(mark).toMatch(/align-self:\s*flex-start/);
  });

  it('sizes the call to action like body text, never under the body floor, in the heading weight', () => {
    const line = declarations(BASE_CSS, '.cta-line');
    expect(line).toMatch(/font-size:\s*max\(var\(--body-floor\)/);
    expect(line).toMatch(/font-weight:\s*var\(--weight-heading\)/);
    expect(line).toMatch(/line-height:\s*var\(--lh-body\)/);
    expect(line).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("draws the sticker and the step label in ink, the colour of the small print's contrast pair, on one line", () => {
    for (const selector of ['.sticker', '.step-label']) {
      const rule = declarations(BASE_CSS, selector);
      expect(rule).toMatch(/font-weight:\s*var\(--weight-heading\)/);
      expect(rule).not.toMatch(/(^|[;\s])color:/); // a colour here would need a pair of its own
    }
    const sticker = declarations(BASE_CSS, '.sticker');
    expect(sticker).toMatch(/align-self:\s*flex-start/);
    expect(sticker).toMatch(/white-space:\s*nowrap/); // a line too wide is seen by the fit check, not wrapped away
  });

  it("clamps the sticker to its column, so a line that is too wide sticks out of the sticker's box and the fit script can measure it", () => {
    // Without a clamp the box grows with its one-line text (`align-self: flex-start`), scrollWidth equals clientWidth
    // and the overflow is seen only as a block outside the text area, with no field to name (#338, CI F1).
    const sticker = declarations(BASE_CSS, '.sticker');
    expect(sticker).toMatch(/max-width:\s*100%/);
    expect(sticker).toMatch(/min-width:\s*0/);
    expect(sticker).toMatch(/overflow:\s*hidden/);
  });

  it('has the fit script measure the call to action, the sticker and the step label', () => {
    for (const name of ['cta-line', 'sticker', 'step-label']) {
      expect(FIT_SCRIPT).toContain(`'${name}'`);
    }
  });
});

describe('the rules of the fact, list and quote layouts (#339)', () => {
  it('sets the quote in the heading font at 0.9 of the title, balanced, in ink', () => {
    const quote = declarations(BASE_CSS, '.quote');
    expect(quote).toMatch(/font-family:\s*var\(--font-heading\)/);
    expect(quote).toMatch(/font-size:\s*calc\(var\(--title-size\) \* 0\.9 \* var\(--k\)\)/);
    expect(quote).toMatch(/line-height:\s*var\(--lh-heading\)/);
    expect(quote).toMatch(/text-wrap:\s*balance/);
    expect(quote).toMatch(/overflow-wrap:\s*break-word/);
    expect(quote).not.toMatch(/(^|[;\s])color:/); // a colour here would need a pair of its own
    expect(QUOTE_TITLE_SHARE).toBe(0.9);
  });

  it('sets the person like body text, never under the body floor, in the heading weight', () => {
    const person = declarations(BASE_CSS, '.person');
    expect(person).toMatch(/font-size:\s*max\(var\(--body-floor\)/);
    expect(person).toMatch(/font-weight:\s*var\(--weight-heading\)/);
    expect(person).toMatch(/line-height:\s*var\(--lh-body\)/);
    expect(person).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('keeps the role and the source at the fixed small-print size, wrapping, in ink', () => {
    expect(declarations(BASE_CSS, '.small-print')).toMatch(/font-size:\s*28px/);
    expect(declarations(BASE_CSS, '.role')).not.toMatch(/font-size|(^|[;\s])color:/);
  });

  it('sets the list items like body text, a little larger, never under the body floor', () => {
    const items = declarations(BASE_CSS, '.items');
    expect(items).toMatch(
      /font-size:\s*max\(var\(--body-floor\), calc\(var\(--body-size\) \* 1\.15/,
    );
    expect(items).toMatch(/line-height:\s*var\(--lh-body\)/);
    expect(items).toMatch(/list-style:\s*none/);
    expect(items).toMatch(/margin:\s*0/);
    expect(items).toMatch(/padding:\s*0/);
    expect(items).toMatch(/gap:\s*var\(--gap\)/);
    expect(items).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('marks each item with a dot drawn in CSS, in the primary: no image, no glyph the font might lack', () => {
    expect(declarations(BASE_CSS, '.item')).toMatch(/position:\s*relative/);
    const dot = declarations(BASE_CSS, '.item::before');
    expect(dot).toMatch(/content:\s*''/);
    expect(dot).toMatch(/background:\s*var\(--primary\)/);
    expect(dot).toMatch(/border-radius:\s*50%/);
  });

  it('sets the person apart from the quote by a gap of its own, so the attribution reads as a second group', () => {
    expect(declarations(BASE_CSS, '.person')).toMatch(/margin-top:\s*var\(--gap\)/);
  });

  it("shares a stacked quote slide's free height: the quote centres above the attribution, which sits at the foot", () => {
    // Auto margins take the free height only; with none left they are 0, so the fit numbers don't move. The quote's own
    // block is not wrapped, because the fit script reads the text area's children to work out the height needed.
    const margins = declarations(BASE_CSS, '.stack .layout-quote .quote');
    expect(margins).toMatch(/margin-top:\s*auto/);
    expect(margins).toMatch(/margin-bottom:\s*auto/);
    expect(declarations(BASE_CSS, '.person')).toMatch(/margin-top:\s*var\(--gap\)/);
  });

  it("gives landscape's text column more room than the picture beside it (fact), and the items more than the title (list)", () => {
    // Two equal columns were too narrow for a fact's body and source, or for a list's items, at the smallest scale
    expect(declarations(BASE_CSS, '.cols .layout-fact .col-text')).toMatch(/flex-grow:\s*3/);
    expect(declarations(BASE_CSS, '.cols .layout-fact .image-box')).toMatch(/flex-grow:\s*2/);
    expect(declarations(BASE_CSS, '.cols .layout-list .col-text')).toMatch(/flex-grow:\s*2/);
    expect(declarations(BASE_CSS, '.cols .layout-list .col-detail')).toMatch(/flex-grow:\s*3/);
  });

  it('has the fit script measure the quote, the person, the role and the list items', () => {
    for (const name of ['quote', 'person', 'role', 'items']) {
      expect(FIT_SCRIPT).toContain(`${name}:`);
    }
  });
});

describe('the constants that the Bangla rules rest on', () => {
  it("are §07's: body 1.65, headings 1.3", () => {
    expect(BANGLA_LINE_HEIGHT_MIN).toEqual({ body: 1.65, heading: 1.3 });
  });
});
