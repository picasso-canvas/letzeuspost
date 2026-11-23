import { describe, expect, it } from 'vitest';
import { ASSET_SCHEME, assetImage, assetUrl, type BuildContext } from './assets.ts';

const context = (): BuildContext => ({ warnings: [] });

describe('assetUrl', () => {
  it("is the job's own scheme: lzp-asset:<kind>/<key>", () => {
    expect(ASSET_SCHEME).toBe('lzp-asset');
    expect(assetUrl('image', 'ast_9f2')).toBe('lzp-asset:image/ast_9f2');
    expect(assetUrl('font', 'ab12')).toBe('lzp-asset:font/ab12');
  });
});

describe('assetImage', () => {
  it('makes an <img> from the asset scheme', () => {
    const ctx = context();
    const node = assetImage(ctx, 'slides[0].image', 'ast_9f2', 'photo');
    expect(node).toMatchObject({ type: 'img', props: { src: 'lzp-asset:image/ast_9f2' } });
    expect(ctx.warnings).toEqual([]);
  });

  it.each([
    'https://evil.test/x.png',
    'http://evil.test/x.png',
    '//evil.test/x.png',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'lzp-asset:image/../x',
    '../x',
    'a b',
    '',
  ])('renders nothing for %j and warns, naming the field but not echoing the value', (source) => {
    const ctx = context();
    expect(assetImage(ctx, 'slides[2].image', source, 'photo')).toBeNull();
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]).toMatchObject({ code: 'image-not-an-asset', field: 'slides[2].image' });
    expect(JSON.stringify(ctx.warnings)).not.toContain('evil');
  });
});
