import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeDispatchLock } from './dispatch-lock.ts';

describe('takeDispatchLock (#148: two dispatches at once)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lzp-lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lets one dispatch in and refuses the second until the first lets go', () => {
    const first = takeDispatchLock(dir, () => true);
    expect(first).toEqual({ release: expect.any(Function) });
    const second = takeDispatchLock(dir, () => true);
    expect(second).toEqual({
      refusal: expect.stringContaining(`pid ${String(process.pid)}`),
    });
    if ('release' in first) first.release();
    expect('release' in takeDispatchLock(dir, () => true)).toBe(true);
  });

  it('releases once, and never removes a lock another dispatch took after a stale one', () => {
    const first = takeDispatchLock(dir, () => true);
    if (!('release' in first)) throw new Error('expected the lock');
    first.release();
    const second = takeDispatchLock(dir, () => true);
    first.release(); // a second call, e.g. from the exit handler, is a no-op
    expect(takeDispatchLock(dir, () => true)).toHaveProperty('refusal');
    if ('release' in second) second.release();
  });

  it('takes over a lock whose process is gone, and says so in its record', () => {
    writeFileSync(join(dir, '.lock'), '99999999\n');
    const taken = takeDispatchLock(dir, (pid) => pid !== 99999999);
    expect(taken).toHaveProperty('release');
    expect(readFileSync(join(dir, '.lock'), 'utf8').trim()).toBe(String(process.pid));
  });

  it('refuses a lock it cannot read, rather than taking it', () => {
    writeFileSync(join(dir, '.lock'), 'not a pid');
    expect(takeDispatchLock(dir, () => false)).toEqual({
      refusal: expect.stringContaining("can't be read"),
    });
  });

  it('makes the folder when there is none', () => {
    expect(takeDispatchLock(join(dir, 'nested', 'dispatch'), () => true)).toHaveProperty('release');
  });
});
