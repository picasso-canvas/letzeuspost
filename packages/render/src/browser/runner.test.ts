import { describe, expect, it } from 'vitest';
import { RenderFailure } from './limits.ts';
import { pageFit } from './runner.ts';

describe('pageFit: what the page’s fit script reported', () => {
  it('is nothing for a page without a fit script', () => {
    expect(pageFit(undefined)).toBeUndefined();
    expect(pageFit(null)).toBeUndefined();
  });

  it('is the report of a page that fits', () => {
    expect(pageFit({ k: 0.9, fits: true, fields: [] })).toEqual({ k: 0.9, fits: true, fields: [] });
  });

  it('keeps the blocks to shorten of a page that does not fit', () => {
    const fields = [{ name: 'title', lines: 5, needed: 500, available: 250, overflowPx: 250 }];
    expect(pageFit({ k: 0.85, fits: false, fields })).toEqual({ k: 0.85, fits: false, fields });
  });

  it('fails the render for a result the fit script could not have made', () => {
    expect(() => pageFit({ k: 3, fits: true, fields: [] })).toThrow(RenderFailure);
    expect(() => pageFit('done')).toThrow(RenderFailure);
  });
});
