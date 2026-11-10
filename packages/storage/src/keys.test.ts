import { describe, expect, it } from 'vitest';
import { assetKey, checkKey, exportKey, renderKey, StorageKeyError } from './keys.ts';

const WORKSPACE = '019a5c3e-7b1a-7c2d-8e3f-4a5b6c7d8e9f';
const OTHER_WORKSPACE = '019a5c3e-7b1a-7c2d-8e3f-4a5b6c7d8ea0';
const BRAND = '019a5c3e-7b1b-7000-8000-000000000001';
const ASSET = '019a5c3e-7b1b-7000-8000-000000000002';
const EXPORT = '019a5c3e-7b1b-7000-8000-000000000003';
const HASH = 'a'.repeat(64);

const ctx = { workspaceId: WORKSPACE };

describe('key builders', () => {
  it('puts an asset under its workspace and brand, one key per size', () => {
    expect(assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: 'original' })).toBe(
      `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}/original`,
    );
    expect(assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: '1600' })).toMatch(/\/1600$/);
    expect(assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: '360' })).toMatch(/\/360$/);
  });

  it('puts a render under its workspace, named by its hash and format', () => {
    for (const format of ['png', 'jpg', 'pdf', 'webp'] as const) {
      expect(renderKey(ctx, { hash: HASH, format })).toBe(
        `ws/${WORKSPACE}/renders/${HASH}.${format}`,
      );
    }
  });

  it('puts an export file under its workspace and export', () => {
    expect(exportKey(ctx, { exportId: EXPORT, name: 'post-1.jpg' })).toBe(
      `ws/${WORKSPACE}/exports/${EXPORT}/post-1.jpg`,
    );
  });

  it('takes the workspace from the context, so two contexts never share a key', () => {
    const other = { workspaceId: OTHER_WORKSPACE };
    const a = renderKey(ctx, { hash: HASH, format: 'png' });
    const b = renderKey(other, { hash: HASH, format: 'png' });
    expect(a.startsWith(`ws/${WORKSPACE}/`)).toBe(true);
    expect(b.startsWith(`ws/${OTHER_WORKSPACE}/`)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('refuses a workspace that is not a UUIDv7, so a key never starts with something else', () => {
    for (const workspaceId of ['', 'x', '../evil', `${WORKSPACE}/..`, WORKSPACE.toUpperCase()]) {
      expect(() => renderKey({ workspaceId }, { hash: HASH, format: 'png' })).toThrow(
        StorageKeyError,
      );
    }
  });

  it('refuses an id, hash or file name that could climb out of its folder', () => {
    const bad = ['', '.', '..', '../x', 'a/b', 'a\\b', 'a b', 'a%2e%2e', 'বাংলা', 'a\u0000b'];
    for (const value of bad) {
      expect(() => exportKey(ctx, { exportId: EXPORT, name: value })).toThrow(StorageKeyError);
      expect(() => exportKey(ctx, { exportId: value, name: 'a.jpg' })).toThrow(StorageKeyError);
      expect(() => renderKey(ctx, { hash: value, format: 'png' })).toThrow(StorageKeyError);
      expect(() => assetKey(ctx, { brandId: value, assetId: ASSET, variant: 'original' })).toThrow(
        StorageKeyError,
      );
      expect(() => assetKey(ctx, { brandId: BRAND, assetId: value, variant: 'original' })).toThrow(
        StorageKeyError,
      );
    }
  });
});

describe('checkKey', () => {
  it('accepts every key a builder makes for the same workspace', () => {
    const keys = [
      assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant: '360' }),
      renderKey(ctx, { hash: HASH, format: 'pdf' }),
      exportKey(ctx, { exportId: EXPORT, name: 'a.zip' }),
    ];
    for (const key of keys) expect(checkKey(ctx, key)).toBe(key);
  });

  it("refuses another workspace's key", () => {
    const key = renderKey({ workspaceId: OTHER_WORKSPACE }, { hash: HASH, format: 'png' });
    expect(() => checkKey(ctx, key)).toThrow(StorageKeyError);
  });

  it('refuses keys that only look like they are inside the workspace', () => {
    const inside = `ws/${WORKSPACE}/renders/${HASH}.png`;
    const tricks = [
      `ws/${OTHER_WORKSPACE}/renders/${HASH}.png`,
      `ws/${WORKSPACE}/../${OTHER_WORKSPACE}/renders/${HASH}.png`,
      `ws/${WORKSPACE}/./renders/${HASH}.png`,
      `ws/${WORKSPACE}//renders/${HASH}.png`,
      `ws/${WORKSPACE}`,
      `ws/${WORKSPACE}/`,
      `/ws/${WORKSPACE}/renders/${HASH}.png`,
      `${WORKSPACE}/renders/${HASH}.png`,
      `ws/${WORKSPACE}x/renders/${HASH}.png`,
      `ws/${WORKSPACE.toUpperCase()}/renders/${HASH}.png`,
      `ws/${WORKSPACE}/renders/${HASH}.png\n`,
      `${inside}?x=1`,
      `${inside}#frag`,
      `ws/${WORKSPACE}/renders/%2e%2e/x`,
      `ws/${WORKSPACE}\\..\\x`,
      `public/${HASH}.jpg`,
      '',
    ];
    for (const key of tricks)
      expect(() => checkKey(ctx, key), JSON.stringify(key)).toThrow(StorageKeyError);
  });

  it("refuses a path under the workspace that isn't one of the three key shapes", () => {
    const strangers = [
      `ws/${WORKSPACE}/anything/x`,
      `ws/${WORKSPACE}/renders/not-a-hash.png`,
      `ws/${WORKSPACE}/renders/${HASH}.gif`,
      `ws/${WORKSPACE}/renders/${HASH}.png/extra`,
      `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}/huge`,
      `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}`,
      `ws/${WORKSPACE}/brands/${BRAND}/assets/${ASSET}/original/extra`,
      `ws/${WORKSPACE}/brands/${BRAND}/logo.png`,
      `ws/${WORKSPACE}/exports/${EXPORT}`,
      `ws/${WORKSPACE}/exports/${EXPORT}/a/b.zip`,
      `ws/${WORKSPACE}/exports/not-an-id/a.zip`,
    ];
    for (const key of strangers) expect(() => checkKey(ctx, key), key).toThrow(StorageKeyError);
  });

  it('refuses when the context itself has no valid workspace', () => {
    expect(() => checkKey({ workspaceId: '' }, `ws//renders/${HASH}.png`)).toThrow(StorageKeyError);
  });
});
