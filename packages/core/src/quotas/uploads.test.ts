// An upload round's limits (§06 Reading uploaded files: "PNG, JPG, WebP, SVG, PDF; up to 20 MB each, 30 files per
// brand at a time") and the storage limit (§02 Running out, and limits: "Brand, seat and storage limits block adding
// more and suggest the next plan"), against the real plans in config/plans.ts: 10, 50 and 200 GB.
import { describe, expect, it } from 'vitest';
import { plans } from '../../../../config/plans.ts';
import {
  checkStorage,
  checkUploadRound,
  GB,
  MAX_FILES_PER_ROUND,
  MAX_UPLOAD_BYTES,
  storagePlans,
  UPLOAD_TYPES,
} from './uploads.ts';

const MB = 1024 * 1024;
const png = (size = 1000) => ({ contentType: 'image/png', size });

describe('checkUploadRound(files)', () => {
  it('signs PNG, JPG, WebP, SVG and PDF, and nothing else', () => {
    expect([...UPLOAD_TYPES].sort()).toEqual(
      ['application/pdf', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'].sort(),
    );
    for (const contentType of UPLOAD_TYPES) {
      expect(checkUploadRound([{ contentType, size: 10 }]), contentType).toEqual({ ok: true });
    }
    for (const contentType of [
      'image/gif',
      'image/heic',
      'text/html',
      'application/octet-stream',
      'image/svg',
      'IMAGE/PNG',
      'image/png; charset=utf-8',
      '',
    ]) {
      expect(checkUploadRound([{ contentType, size: 10 }]), contentType).toMatchObject({
        ok: false,
        refused: 'type',
        message: 'Only PNG, JPG, WebP, SVG and PDF files can be uploaded.',
      });
    }
  });

  it('allows files up to 20 MB each, and refuses one byte more', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * MB);
    expect(checkUploadRound([png(20 * MB)])).toEqual({ ok: true });
    expect(checkUploadRound([png(20 * MB + 1)])).toMatchObject({
      ok: false,
      refused: 'too-large',
      message: 'Each file can be at most 20 MB.',
    });
  });

  it('refuses a size that is no size of a file', () => {
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkUploadRound([png(size)]), String(size)).toMatchObject({
        ok: false,
        refused: 'size',
      });
    }
  });

  it('allows up to 30 files in a round, and refuses 31 or none', () => {
    expect(MAX_FILES_PER_ROUND).toBe(30);
    const files = (n: number) => Array.from({ length: n }, () => png());
    expect(checkUploadRound(files(1))).toEqual({ ok: true });
    expect(checkUploadRound(files(30))).toEqual({ ok: true });
    expect(checkUploadRound(files(31))).toMatchObject({
      ok: false,
      refused: 'too-many',
      message: 'At most 30 files can be uploaded at a time.',
    });
    expect(checkUploadRound([])).toMatchObject({ ok: false, refused: 'none' });
  });

  it('refuses the whole round when one file is refused', () => {
    expect(checkUploadRound([png(), { contentType: 'image/gif', size: 10 }, png()])).toMatchObject({
      ok: false,
      refused: 'type',
    });
  });
});

describe('storagePlans(plans, planId)', () => {
  it('gives a plan and the next one up, and none past the largest', () => {
    expect(storagePlans(plans, 'starter')).toEqual({ plan: plans.starter, next: plans.agency });
    expect(storagePlans(plans, 'agency')).toEqual({ plan: plans.agency, next: plans.scale });
    expect(storagePlans(plans, 'scale')).toEqual({ plan: plans.scale, next: null });
  });

  it('holds a workspace that has no plan yet to the smallest one (Zeus, 2026-11-26, on #403)', () => {
    expect(storagePlans(plans, null)).toEqual({ plan: plans.starter, next: plans.agency });
  });

  it('refuses a plan it doesn’t know, rather than guess a limit', () => {
    expect(() => storagePlans(plans, 'enterprise')).toThrow('no such plan');
    expect(() => storagePlans(plans, 'toString')).toThrow('no such plan');
  });
});

describe('checkStorage({ plan, next, usedBytes, addingBytes })', () => {
  it.each([
    ['starter', 10],
    ['agency', 50],
    ['scale', 200],
  ] as const)('%s: allows up to its %i GB, and refuses a byte past it', (name, gb) => {
    const { plan, next } = storagePlans(plans, name);
    expect(plan.storageGb).toBe(gb);
    const limit = gb * GB;
    expect(checkStorage({ plan, next, usedBytes: 0, addingBytes: limit })).toEqual({ ok: true });
    expect(checkStorage({ plan, next, usedBytes: limit - 10, addingBytes: 10 })).toEqual({
      ok: true,
    });
    expect(checkStorage({ plan, next, usedBytes: limit - 10, addingBytes: 11 })).toMatchObject({
      ok: false,
    });
    // Already over, after a downgrade (§02): nothing more fits.
    expect(checkStorage({ plan, next, usedBytes: limit + 1, addingBytes: 1 })).toMatchObject({
      ok: false,
    });
  });

  it('suggests the next plan, with its storage, when one is past the limit', () => {
    const { plan, next } = storagePlans(plans, 'starter');
    expect(checkStorage({ plan, next, usedBytes: 10 * GB, addingBytes: 1 })).toEqual({
      ok: false,
      message:
        'These files would go past the 10 GB of storage in your Starter plan. The Agency plan has 50 GB.',
    });
    const agency = storagePlans(plans, 'agency');
    expect(checkStorage({ ...agency, usedBytes: 50 * GB, addingBytes: 1 })).toEqual({
      ok: false,
      message:
        'These files would go past the 50 GB of storage in your Agency plan. The Scale plan has 200 GB.',
    });
  });

  it('on the largest plan, says to make room or ask, as there is no next plan', () => {
    const { plan, next } = storagePlans(plans, 'scale');
    expect(checkStorage({ plan, next, usedBytes: 200 * GB, addingBytes: 1 })).toEqual({
      ok: false,
      message:
        'These files would go past the 200 GB of storage in your Scale plan. Delete some files, or contact us for more.',
    });
  });

  it('refuses amounts that are no amounts of bytes', () => {
    const { plan, next } = storagePlans(plans, 'starter');
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => checkStorage({ plan, next, usedBytes: bad, addingBytes: 1 })).toThrow(
        'a number of bytes',
      );
      expect(() => checkStorage({ plan, next, usedBytes: 0, addingBytes: bad })).toThrow(
        'a number of bytes',
      );
    }
  });
});
