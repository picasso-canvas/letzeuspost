// What `brandKits(db, kitSchema)` refuses before it reaches the database (#399): a kit its schema refuses (here #398's
// `BrandKitSchema`, as the app passes it), and ids that are no ids. Nothing is written and no transaction is opened.
// What it writes, and what the database refuses, is in brand-kits.int.test.ts (CI's services job).
import { describe, expect, it } from 'vitest';
import { BrandKitSchema } from '../../core/src/index.ts';
import { brandKits } from './brand-kits.ts';
import type { Db } from './db.ts';

/** A database that counts the transactions opened on it, and refuses them all. */
function countingDb(): { db: Db; opened: () => number } {
  let opened = 0;
  const db: Db = {
    forWorkspace: () => ({
      transaction: () => {
        opened += 1;
        return Promise.reject(new Error('no database in a unit test'));
      },
    }),
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { db, opened: () => opened };
}

const ctx = { workspaceId: '019ab8c2-7f00-7000-8000-000000000001' };
const brandId = '019ab8c2-7f00-7000-8000-0000000000b1';
const at = '2026-11-25T09:00:00.000Z';
const named = (value: string) => ({ value, source: 'typed', ref: null, at, confidence: 'found' });

/** A kit with every part, as the editor sends it. */
function kitWith(identity: Record<string, unknown>): unknown {
  return { identity, voice: {}, facts: {}, look: {}, rules: {}, publishing: {}, holidays: {} };
}

describe('brandKits(db, kitSchema).saveKit(ctx, brand, kit)', () => {
  it.each([
    ['a colour that is no hex colour', kitWith({ colors: { primary: named('red') } })],
    ['an item without its source', kitWith({ name: { value: 'গল্প ক্যাফে' } })],
    ['a part the kit has no place for', { ...(kitWith({}) as object), extra: {} }],
    ['a kit missing a part', { identity: {} }],
    ['no kit at all', null],
  ])('refuses %s, and writes nothing', async (_label, kit) => {
    const { db, opened } = countingDb();
    await expect(brandKits(db, BrandKitSchema).saveKit(ctx, brandId, kit)).rejects.toThrow();
    expect(opened()).toBe(0);
  });

  it('refuses a brand id that is no UUIDv7, and writes nothing', async () => {
    const { db, opened } = countingDb();
    const kit = kitWith({ name: named('Golpo Café'), nameBn: named('গল্প ক্যাফে') });
    for (const id of ['', 'golpo', "x' or 1=1 --", '00000000-0000-0000-0000-000000000000']) {
      await expect(brandKits(db, BrandKitSchema).saveKit(ctx, id, kit), id).rejects.toThrow(
        'not a brand id',
      );
    }
    expect(opened()).toBe(0);
  });

  it('takes a valid kit on to the database, in the workspace it was given', async () => {
    const { db, opened } = countingDb();
    const kit = kitWith({ name: named('Golpo Café'), nameBn: named('গল্প ক্যাফে') });
    await expect(brandKits(db, BrandKitSchema).saveKit(ctx, brandId, kit)).rejects.toThrow(
      'no database in a unit test',
    );
    expect(opened()).toBe(1);
  });
});

describe('brandKits(db, kitSchema).kitVersions(ctx, brand)', () => {
  it('refuses a brand id that is no UUIDv7, and reads nothing', async () => {
    const { db, opened } = countingDb();
    await expect(brandKits(db, BrandKitSchema).kitVersions(ctx, 'golpo')).rejects.toThrow(
      'not a brand id',
    );
    expect(opened()).toBe(0);
  });
});

describe('brandKits(db, kitSchema).createBrand(ctx, brand, allowed)', () => {
  it.each([
    ['an empty English name', { nameEn: '   ' }],
    ['an English name past 200 characters', { nameEn: 'গ'.repeat(201) }],
    ['an empty Bangla name', { nameEn: 'Golpo Café', nameBn: '' }],
  ])('refuses %s, and writes nothing', async (_label, input) => {
    const { db, opened } = countingDb();
    await expect(
      brandKits(db, BrandKitSchema).createBrand(ctx, input, () => true),
    ).rejects.toThrow();
    expect(opened()).toBe(0);
  });

  it('refuses a workspace id that is no UUIDv7, and writes nothing', async () => {
    const { db, opened } = countingDb();
    await expect(
      brandKits(db, BrandKitSchema).createBrand(
        { workspaceId: 'a' },
        { nameEn: 'Golpo' },
        () => true,
      ),
    ).rejects.toThrow('not a workspace id');
    expect(opened()).toBe(0);
  });
});
