import { createElement as h, type ReactNode } from 'react';
import { ASSET_KEY } from '../kit.ts';

// The job's own assets. The render browser has no internet (§08 Security): every request from the page is
// intercepted, and the worker answers only the ones in this scheme, from storage. The editor preview maps the same
// addresses to its own signed links. This is the one place that names the scheme; the content policy
// (`page/content-policy.ts`) allows images and fonts from it and from nowhere else.
//
//   lzp-asset:image/<asset key>   a logo, a mascot or a photo of the job (the key is the post's `asset`)
//   lzp-asset:font/<sha256>       a font file, by the sha256 in the font manifest
export const ASSET_SCHEME = 'lzp-asset';

export type AssetKind = 'image' | 'font';

export const assetUrl = (kind: AssetKind, key: string): string => `${ASSET_SCHEME}:${kind}/${key}`;

/** What went wrong on a page that still built. `field` names where the input was, never what it said. */
export type BuildWarning = { code: 'image-not-an-asset'; field: string; message: string };

/** What a build collects on the way: today only warnings. */
export type BuildContext = { warnings: BuildWarning[] };

/**
 * An `<img>` for an asset key. A key is a short word, so a web address, a `data:` URL or a path is not one: the
 * result is no image and a warning, never an `<img>` that points anywhere (§08: a render can't reach the network).
 * Logos and photos load as `<img>`, where an SVG's scripts never run.
 */
export function assetImage(
  context: BuildContext,
  field: string,
  key: string,
  className: string,
): ReactNode {
  if (!ASSET_KEY.test(key)) {
    context.warnings.push({
      code: 'image-not-an-asset',
      field,
      message: `${field} is not an asset of this job, so no image was drawn`,
    });
    return null;
  }
  return h('img', { src: assetUrl('image', key), alt: '', className });
}
