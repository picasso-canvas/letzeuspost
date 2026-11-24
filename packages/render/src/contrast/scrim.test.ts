import { describe, expect, it } from 'vitest';
import { contrastRatio } from './colour.ts';
import { SCRIM_ALPHA, photoBackdrops, scrimFor } from './scrim.ts';

describe('the scrim rule (§08)', () => {
  it('is at least 60%', () => {
    expect(SCRIM_ALPHA).toBeGreaterThanOrEqual(0.6);
  });

  it('gives light text a dark scrim and dark text a light one', () => {
    expect(scrimFor('#ffffff')).toEqual({ colour: '#000000', alpha: SCRIM_ALPHA });
    expect(scrimFor('#fff8f0').colour).toBe('#000000');
    expect(scrimFor('#1b1b1b')).toEqual({ colour: '#ffffff', alpha: SCRIM_ALPHA });
  });

  it('keeps white text at 4.5:1 or more over a white photo behind the scrim, by calculation', () => {
    const scrim = scrimFor('#ffffff');
    const channel = Math.round(255 * (1 - scrim.alpha)); // black scrim over a pure white photo
    const behindScrim = `#${channel.toString(16).padStart(2, '0').repeat(3)}`;
    expect(contrastRatio('#ffffff', behindScrim)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', behindScrim)).toBeCloseTo(5.7, 1);
  });

  it('lists what the scrim looks like over the brightest and the darkest photo', () => {
    expect(photoBackdrops('#ffffff')).toEqual(['#666666', '#000000']);
    expect(photoBackdrops('#1b1b1b')).toEqual(['#ffffff', '#999999']);
  });

  it('has every backdrop of a scrimmed photo reach 4.5:1 for white and near-black text', () => {
    for (const text of ['#ffffff', '#1b1b1b']) {
      for (const backdrop of photoBackdrops(text)) {
        expect(contrastRatio(text, backdrop)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('refuses a text colour that is not a hex colour', () => {
    expect(() => scrimFor('white')).toThrow();
  });
});
