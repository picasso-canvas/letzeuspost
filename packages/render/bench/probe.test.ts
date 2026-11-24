import { describe, expect, it } from 'vitest';
import { residentBytes } from '../src/browser/memory.ts';
import { statusFromPs } from './probe.ts';

describe('statusFromPs', () => {
  it('turns `ps -o rss=` into the /proc status text the renderer’s own memory reader parses', async () => {
    const status = statusFromPs('  2048\n');
    expect(await residentBytes([1], () => Promise.resolve(status))).toBe(2048 * 1024);
  });

  it('refuses output that is not a size, so a failed ps is not read as 0 bytes', () => {
    expect(() => statusFromPs('')).toThrow('ps gave no size');
    expect(() => statusFromPs('ps: no such process')).toThrow('ps gave no size');
  });
});
