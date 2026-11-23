import { describe, expect, it } from 'vitest';
import { FIT_SCRIPT, IMAGE_BOX_MIN_SHARE } from '../fit/script.ts';
import { BANGLA_LINE_HEIGHT_MIN } from '../fonts/manifest.ts';
import { SIZES } from '../sizes.ts';
import { BASE_CSS, sizeCss } from './base-css.ts';

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

describe('the constants that the Bangla rules rest on', () => {
  it("are §07's: body 1.65, headings 1.3", () => {
    expect(BANGLA_LINE_HEIGHT_MIN).toEqual({ body: 1.65, heading: 1.3 });
  });
});
