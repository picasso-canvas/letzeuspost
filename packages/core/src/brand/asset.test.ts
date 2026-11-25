import { describe, expect, it } from 'vitest';
import {
  ASSET_KINDS,
  ASSET_SOURCES,
  ASSET_STATUSES,
  isUsableInPost,
  type AssetKind,
  type UsableAsset,
} from './asset.ts';

/** A ready photo with no people in it: usable. Each test changes one thing. */
const photo = (change: Partial<UsableAsset> = {}): UsableAsset => ({
  kind: 'photo',
  status: 'ready',
  peoplePresent: false,
  consent: false,
  ...change,
});

describe('the asset library’s kinds, statuses and sources (§06, §10, §13)', () => {
  it('has §06’s five kinds and `example`, the post screenshots that teach the voice', () => {
    expect(ASSET_KINDS).toEqual(['logo', 'photo', 'product', 'people', 'document', 'example']);
  });

  it('has §13’s statuses and sources', () => {
    expect(ASSET_STATUSES).toEqual(['ready', 'waiting', 'rejected']);
    expect(ASSET_SOURCES).toEqual(['own', 'client', 'cutout']);
  });
});

describe('isUsableInPost', () => {
  it('takes a ready photo with no people in it', () => {
    expect(isUsableInPost(photo())).toBe(true);
  });

  it.each(['logo', 'photo', 'product', 'document'] as const)(
    'takes a ready %s with no people in it',
    (kind) => {
      expect(isUsableInPost(photo({ kind }))).toBe(true);
    },
  );

  it('refuses an asset still waiting (being processed, or a client’s photo not yet approved)', () => {
    expect(isUsableInPost(photo({ status: 'waiting' }))).toBe(false);
    expect(isUsableInPost(photo({ status: 'waiting', consent: true }))).toBe(false);
  });

  it('refuses a rejected asset', () => {
    expect(isUsableInPost(photo({ status: 'rejected' }))).toBe(false);
    expect(isUsableInPost(photo({ status: 'rejected', consent: true }))).toBe(false);
  });

  it('refuses a photo with people in it until consent is ticked (§10, §22)', () => {
    expect(isUsableInPost(photo({ peoplePresent: true }))).toBe(false);
    expect(isUsableInPost(photo({ peoplePresent: true, consent: true }))).toBe(true);
  });

  it('refuses a `people` asset without consent, whatever its people flag says', () => {
    expect(isUsableInPost(photo({ kind: 'people' }))).toBe(false);
    expect(isUsableInPost(photo({ kind: 'people', peoplePresent: null }))).toBe(false);
    expect(isUsableInPost(photo({ kind: 'people', consent: true }))).toBe(true);
  });

  it('counts people as present until someone or the tagging says there are none', () => {
    expect(isUsableInPost(photo({ peoplePresent: null }))).toBe(false);
    expect(isUsableInPost(photo({ peoplePresent: null, consent: true }))).toBe(true);
  });

  it('never offers an `example` (a post screenshot) for a post, even ready and with consent', () => {
    expect(isUsableInPost(photo({ kind: 'example' }))).toBe(false);
    expect(isUsableInPost(photo({ kind: 'example', consent: true }))).toBe(false);
  });

  it('refuses a kind it doesn’t know (a value from an older or newer database)', () => {
    expect(isUsableInPost(photo({ kind: 'video' as AssetKind }))).toBe(false);
  });
});
