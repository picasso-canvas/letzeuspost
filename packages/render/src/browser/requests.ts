import { ASSET_KEY } from '../kit.ts';
import { sha256Base64 } from '../page/sha256.ts';

// `page/assets.ts`'s scheme and kinds, restated so the render browser doesn't load React (that file draws `<img>`s);
// requests.test.ts holds them equal.
export const ASSET_SCHEME = 'lzp-asset';
export type AssetKind = 'image' | 'font';

// The render browser's only source of bytes (§08 Security: the render browser has no internet). The page is served
// from an address that exists nowhere, every request from it is intercepted, and only the job's own assets on that
// address are answered; anything else is blocked and logged by its origin and path. Chrome can't intercept a custom
// scheme, so the page's `lzp-asset:` addresses are pointed at that origin before it loads, and its content policy with
// them.

/** The page's own origin: `.invalid` never resolves (RFC 6761), and the request filter answers it before any lookup. */
export const PAGE_ORIGIN = 'https://render.lzp.invalid';
export const PAGE_URL = `${PAGE_ORIGIN}/`;

/** An asset of the job: an image by its asset key, or a font file by its sha256. */
export type RenderAsset = {
  kind: AssetKind;
  key: string;
  contentType: string;
  data: Uint8Array;
};

export type AssetIndex = ReadonlyMap<string, RenderAsset>;

const MAX_LOGGED = 300;

/**
 * A blocked request's address as it is logged: its origin and path only, never its query string, fragment, user name
 * or password (they can carry tokens or a person's data), and at most 300 characters.
 */
export function loggedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '(not a valid address)';
  }
  const origin = parsed.origin === 'null' ? parsed.protocol : parsed.origin;
  return `${origin}${parsed.pathname}`.slice(0, MAX_LOGGED);
}

const KEYS: Record<AssetKind, RegExp> = { image: ASSET_KEY, font: /^[0-9a-f]{64}$/ };
const TYPES: Record<AssetKind, readonly string[]> = {
  // An SVG is drawn as an `<img>`, where its scripts never run (§08 Security).
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
  font: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'],
};

/** The job's assets by their address on the page origin; refuses a key or type that isn't its kind's, or a key twice. */
export function assetIndex(assets: readonly RenderAsset[]): AssetIndex {
  const index = new Map<string, RenderAsset>();
  for (const asset of assets) {
    if (!KEYS[asset.kind].test(asset.key))
      throw new Error(`A render asset's key isn't a ${asset.kind} key`);
    if (!TYPES[asset.kind].includes(asset.contentType))
      throw new Error(`A render asset's type ${asset.contentType} isn't a ${asset.kind} type`);
    const path = `${asset.kind}/${asset.key}`;
    if (index.has(path)) throw new Error(`The render asset ${path} is given twice`);
    index.set(path, asset);
  }
  return index;
}

/** The asset a request asks for: only on the page origin, by its exact path, with no query string or fragment. */
export function findAsset(index: AssetIndex, url: string): RenderAsset | undefined {
  const prefix = `${PAGE_ORIGIN}/`;
  if (!url.startsWith(prefix) || url.includes('?') || url.includes('#')) return undefined;
  return index.get(url.slice(prefix.length));
}

const POLICY = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/?>/;
const STYLE = /<style>([\s\S]*?)<\/style>/;

/**
 * The page as the render browser loads it: its images (`src="lzp-asset:…"`, and React's preload `href`) and its fonts (`url(lzp-asset:…)` in its
 * one `<style>`) on the page origin, and its content policy allowing images and fonts from there instead, with the
 * hash of the style as it now reads. Post text is escaped, so it can't hold `src="` or `href="`, and the style holds none: the
 * text of a post is never changed.
 */
export function servedHtml(html: string): string {
  const scheme = `${ASSET_SCHEME}:`;
  if (!html.includes(scheme)) return html;
  const style = STYLE.exec(html)?.[1];
  const served = style?.replaceAll(`url(${scheme}`, `url(${PAGE_URL}`);
  // React adds a `<link rel="preload" href="…">` for each image.
  let page = html
    .replaceAll(`src="${scheme}`, `src="${PAGE_URL}`)
    .replaceAll(`href="${scheme}`, `href="${PAGE_URL}`);
  if (style !== undefined && served !== undefined && served !== style)
    page = page.replace(STYLE, () => `<style>${served}</style>`);
  return page.replace(POLICY, (meta, policy: string) => {
    let rewritten = policy
      .replace(`img-src ${scheme}`, `img-src ${PAGE_ORIGIN}`)
      .replace(`font-src ${scheme}`, `font-src ${PAGE_ORIGIN}`);
    if (style !== undefined && served !== undefined && served !== style)
      rewritten = rewritten.replace(
        `sha256-${sha256Base64(style)}`,
        `sha256-${sha256Base64(served)}`,
      );
    return meta.replace(policy, rewritten);
  });
}
