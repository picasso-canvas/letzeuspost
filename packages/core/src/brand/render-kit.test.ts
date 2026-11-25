import { describe, expect, it } from 'vitest';
// This import crosses the package boundary on purpose. core can't depend on render (render depends on core), so no
// production file in core imports it. A test may: it is never shipped and adds no dependency. It is the drift check:
// whatever `toRenderKit` returns must parse with the renderer's own `RenderKitSchema`, so a change to either side
// that breaks the other fails here.
import { RenderKitSchema } from '../../../render/src/kit.ts';
import { TEMPORARY_WORDMARK } from './kit.ts';
import { toRenderKit } from './render-kit.ts';
import { emptyKit, fullKit, item } from './test-fixtures.ts';

describe('toRenderKit', () => {
  it('gives the renderer what the kit holds: colours, fonts, logos and the mascot', () => {
    const renderKit = toRenderKit(fullKit());
    expect(renderKit).toEqual({
      colors: {
        primary: '#8b2e16',
        accent: '#f2b134',
        background: '#fff8ee',
        ink: '#1b1b1b',
        extras: ['#2f6f4f'],
      },
      fonts: {
        en: { heading: 'Baloo 2', body: 'Nunito' },
        bn: { heading: 'Baloo Da 2', body: 'Hind Siliguri' },
      },
      logo: { light: 'logo_light_1', dark: 'logo_dark_1' },
      mascot: 'mascot_1',
    });
  });

  it('is a valid RenderKit for a full kit', () => {
    expect(RenderKitSchema.safeParse(toRenderKit(fullKit())).success).toBe(true);
  });

  it('is a valid RenderKit for an empty kit too: defaults fill what is missing', () => {
    const renderKit = toRenderKit(emptyKit());
    expect(RenderKitSchema.safeParse(renderKit).success).toBe(true);
    expect(renderKit.mascot).toBeUndefined();
  });

  it('gives a temporary-wordmark marker when the kit has no logo', () => {
    const kit = fullKit();
    kit.identity = { ...kit.identity, logo: undefined };
    const renderKit = toRenderKit(kit);
    expect(renderKit.logo).toEqual({ light: TEMPORARY_WORDMARK, dark: TEMPORARY_WORDMARK });
    expect(RenderKitSchema.safeParse(renderKit).success).toBe(true);
  });

  it('uses the one logo it has for both backgrounds, and no marker', () => {
    const kit = fullKit();
    kit.identity = { ...kit.identity, logo: { light: item('only_logo') } };
    expect(toRenderKit(kit).logo).toEqual({ light: 'only_logo', dark: 'only_logo' });
    kit.identity = { ...kit.identity, logo: { dark: item('only_dark') } };
    expect(toRenderKit(kit).logo).toEqual({ light: 'only_dark', dark: 'only_dark' });
  });

  it('falls back to the default font pair when the kit knows no fonts', () => {
    const kit = fullKit();
    kit.identity = { ...kit.identity, fonts: undefined };
    const renderKit = toRenderKit(kit);
    expect(renderKit.fonts).toEqual({
      en: { heading: 'Nunito', body: 'Nunito' },
      bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
    });
    expect(RenderKitSchema.safeParse(renderKit).success).toBe(true);
  });

  it('keeps the kit’s font when the caller says it is known, and drops it when not', () => {
    const kit = fullKit();
    const known = (family: string) => family !== 'Baloo 2';
    const renderKit = toRenderKit(kit, { isKnownFont: known });
    expect(renderKit.fonts.en).toEqual({ heading: 'Nunito', body: 'Nunito' });
    expect(renderKit.fonts.bn).toEqual({ heading: 'Baloo Da 2', body: 'Hind Siliguri' });
  });

  it('leaves out the mascot when the kit has none', () => {
    const kit = fullKit();
    kit.identity = { ...kit.identity, mascot: undefined };
    expect('mascot' in toRenderKit(kit)).toBe(false);
  });

  it('does not change the kit it was given', () => {
    const kit = fullKit();
    const before = structuredClone(kit);
    toRenderKit(kit);
    expect(kit).toEqual(before);
  });
});
