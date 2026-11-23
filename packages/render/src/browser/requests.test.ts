import { beforeAll, describe, expect, it } from 'vitest';
import { buildSlide } from '../page/build-slide.ts';
import { registerLook } from '../page/looks.ts';
import { sha256Base64 } from '../page/sha256.ts';
import { TEST_LOOK, testKit, testPost, testSlide } from '../page/test-fixtures.ts';
import { ASSET_SCHEME as BUILDER_SCHEME, type AssetKind as BuilderKind } from '../page/assets.ts';
import {
  ASSET_SCHEME,
  assetIndex,
  findAsset,
  loggedUrl,
  PAGE_ORIGIN,
  PAGE_URL,
  servedHtml,
  type AssetKind,
} from './requests.ts';

describe('the asset addresses the runner serves', () => {
  it('are the page builder’s: the same scheme and kinds', () => {
    expect(ASSET_SCHEME).toBe(BUILDER_SCHEME);
    // The typecheck fails here when the kinds differ.
    const sameKinds: [AssetKind] extends [BuilderKind]
      ? [BuilderKind] extends [AssetKind]
        ? true
        : false
      : false = true;
    expect(sameKinds).toBe(true);
  });
});

beforeAll(() => {
  registerLook(TEST_LOOK);
});

const FONT_SHA = 'a'.repeat(64);
const png = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: new Uint8Array([1]),
} as const;
const woff2 = {
  kind: 'font',
  key: FONT_SHA,
  contentType: 'font/woff2',
  data: new Uint8Array([2]),
} as const;

describe('loggedUrl: a blocked request is logged by its origin and path only', () => {
  it('drops the query string, the fragment and any user name or password', () => {
    expect(loggedUrl('https://user:secret@cdn.example.com:8443/img/a.png?token=abc#top')).toBe(
      'https://cdn.example.com:8443/img/a.png',
    );
    expect(loggedUrl('http://198.51.100.7/collect?id=1')).toBe('http://198.51.100.7/collect');
  });

  it('keeps a non-web address to its scheme and path, without its query', () => {
    expect(loggedUrl('lzp-asset:image/logo?x=1')).toBe('lzp-asset:image/logo');
  });

  it('cuts a very long path short and never throws on a bad address', () => {
    const logged = loggedUrl(`https://example.com/${'a'.repeat(5000)}`);
    expect(logged.length).toBeLessThanOrEqual(300);
    expect(logged.startsWith('https://example.com/aaa')).toBe(true);
    expect(loggedUrl('not a url')).toBe('(not a valid address)');
  });
});

describe('findAsset: only the job’s own assets are served', () => {
  const index = assetIndex([png, woff2]);

  it('serves an image or a font passed for this job, on the page’s own origin', () => {
    expect(findAsset(index, `${PAGE_ORIGIN}/image/logo_light_1`)).toBe(png);
    expect(findAsset(index, `${PAGE_ORIGIN}/font/${FONT_SHA}`)).toBe(woff2);
  });

  it('serves nothing for another key, another kind, another origin or a query string', () => {
    expect(findAsset(index, `${PAGE_ORIGIN}/image/logo_dark_1`)).toBeUndefined();
    expect(findAsset(index, `${PAGE_ORIGIN}/font/logo_light_1`)).toBeUndefined();
    expect(findAsset(index, 'https://cdn.example.com/image/logo_light_1')).toBeUndefined();
    expect(findAsset(index, `http://render.lzp.invalid/image/logo_light_1`)).toBeUndefined();
    expect(findAsset(index, `${PAGE_ORIGIN}/image/logo_light_1?v=2`)).toBeUndefined();
    expect(findAsset(index, `${PAGE_ORIGIN}/image/logo_light_1#x`)).toBeUndefined();
    expect(findAsset(index, PAGE_URL)).toBeUndefined();
  });

  it('refuses an asset with a key that isn’t one, a type that isn’t its kind’s, or a key given twice', () => {
    expect(() => assetIndex([{ ...png, key: 'https://cdn.example.com/a.png' }])).toThrow(/key/);
    expect(() => assetIndex([{ ...woff2, key: 'Nunito' }])).toThrow(/key/);
    expect(() => assetIndex([{ ...png, contentType: 'text/html' }])).toThrow(/type/);
    expect(() => assetIndex([{ ...woff2, contentType: 'image/svg+xml' }])).toThrow(/type/);
    expect(() => assetIndex([png, png])).toThrow(/twice/);
  });
});

describe('servedHtml: the page’s asset addresses point at the page’s own origin', () => {
  const policyOf = (html: string) =>
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const page = (title = 'Pitha is *older* than tea') => {
    const post = testPost(testSlide({ title }));
    const slide = post.slides[0];
    if (slide === undefined) throw new Error('no slide');
    return buildSlide(post, slide, 'portrait', testKit());
  };

  it('maps every image and font address to the page origin and keeps the content policy whole', () => {
    const before = page();
    const served = servedHtml(before);
    expect(before).toContain('lzp-asset:');
    expect(served).not.toContain('lzp-asset:');
    expect(served).toContain(`src="${PAGE_ORIGIN}/image/logo_light_1"`);
    expect(served).toContain(`href="${PAGE_ORIGIN}/image/logo_light_1"`);
    expect(styleOf(served)).toMatch(new RegExp(`url\\(${PAGE_ORIGIN}/font/[0-9a-f]{64}\\)`));

    const policy = policyOf(served);
    expect(policy).toContain(`img-src ${PAGE_ORIGIN};`);
    expect(policy).toContain(`font-src ${PAGE_ORIGIN};`);
    // The style is allowed by the hash of what it now says, and only by that.
    expect(policy).toContain(`sha256-${sha256Base64(styleOf(served))}`);
    expect(policy).not.toContain(`sha256-${sha256Base64(styleOf(before))}`);
    expect(policy).toContain('default-src &#x27;none&#x27;');
  });

  it('leaves the text of a post alone, even when it spells out an asset address', () => {
    const served = servedHtml(page('See url(lzp-asset:font/x) and src="lzp-asset:image/y"'));
    expect(served).toContain('url(lzp-asset:font/x)');
    expect(served).toContain('src=&quot;lzp-asset:image/y&quot;');
  });

  it('leaves a page with no asset addresses as it is', () => {
    const html = '<!DOCTYPE html><html><body><p>Hello</p></body></html>';
    expect(servedHtml(html)).toBe(html);
  });
});
