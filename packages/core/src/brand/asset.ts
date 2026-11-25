// The asset library's rules (§06 Asset library, §10 Licences, consent and credits, §13 Data model, Files; #400). Pure:
// no database, no files. packages/db's `asset` table holds the same kinds, sources and statuses (its checks).
//
// An asset can go in a post only once it is ready: processed (checked, re-encoded and copied, §13 File storage) and,
// for a client's photo, approved (§10). Recognisable people need the consent tick (§10, §22), and until the tagging or
// an editor says there are none, they count as there. An `example` is a screenshot of a past post that teaches the
// voice (§06): never offered for a post.

/** §06's kinds, and `example` (#400). */
export const ASSET_KINDS = ['logo', 'photo', 'product', 'people', 'document', 'example'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** `waiting` until processed (and, for a client's photo, approved); `rejected` never used. */
export const ASSET_STATUSES = ['ready', 'waiting', 'rejected'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** The agency's own, from the client (the review link, §10), or a cutout of another asset. */
export const ASSET_SOURCES = ['own', 'client', 'cutout'] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/** The kinds a post may use: every kind but `example`. */
const FOR_POSTS: readonly string[] = ['logo', 'photo', 'product', 'people', 'document'];

/** What `isUsableInPost` reads of an asset (a row of packages/db's `asset` table has these and more). */
export interface UsableAsset {
  readonly kind: AssetKind;
  readonly status: AssetStatus;
  /** Recognisable people in it; `null` until the tagging or an editor says, and counted as yes. */
  readonly peoplePresent: boolean | null;
  readonly consent: boolean;
}

/** Whether a post may use the asset: ready, not an example, and with consent where people are (or may be) in it. */
export function isUsableInPost(asset: UsableAsset): boolean {
  if (asset.status !== 'ready') return false;
  // A kind this code doesn't know (from an older or newer database) is refused, like `example`.
  if (!FOR_POSTS.includes(asset.kind)) return false;
  const people = asset.kind === 'people' || asset.peoplePresent !== false;
  return !people || asset.consent;
}
