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
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets one dispatch in and refuses the second until the first lets go', () => {
    const first = takeDispatchLock(dir, () => true);
    expect(first).toHaveProperty('release');
    const second = takeDispatchLock(dir, () => true);
    expect('refusal' in second && second.refusal).toContain(`pid ${String(process.pid)}`);
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

  it("doesn't remove a lock another dispatch took while this one was deciding the holder was dead", () => {
    const path = join(dir, '.lock');
    writeFileSync(path, '99999999\n');
    // While this taker decides the holder is dead, another taker takes the stale lock over completely.
    let first = true;
    const taken = takeDispatchLock(dir, (pid) => {
      if (first && pid === 99999999) {
        first = false;
        rmSync(path);
        writeFileSync(path, '12345\n');
        return false;
      }
      return pid === 12345;
    });
    expect('refusal' in taken && taken.refusal).toContain('pid 12345');
    expect(readFileSync(path, 'utf8').trim()).toBe('12345');
  });

  it('refuses while another dispatch is taking over a stale lock', () => {
    writeFileSync(join(dir, '.lock'), '99999999\n');
    writeFileSync(join(dir, '.lock.takeover'), '4242\n');
    const taken = takeDispatchLock(dir, (pid) => pid !== 99999999);
    expect('refusal' in taken && taken.refusal).toContain('taking over');
    // The refusal says whose guard it is and whether that process is alive, so a dead one can be removed by hand.
    expect('refusal' in taken && taken.refusal).toContain('pid 4242');
    expect('refusal' in taken && taken.refusal).toContain('still running');
    expect(readFileSync(join(dir, '.lock'), 'utf8').trim()).toBe('99999999');
  });

  it('says a guard whose process is gone can be removed by hand', () => {
    writeFileSync(join(dir, '.lock'), '99999999\n');
    writeFileSync(join(dir, '.lock.takeover'), '4242\n');
    const taken = takeDispatchLock(dir, (pid) => pid === 12345);
    expect('refusal' in taken && taken.refusal).toContain('pid 4242');
    expect('refusal' in taken && taken.refusal).toContain('is gone');
  });

  it('refuses a lock it cannot read, rather than taking it', () => {
    writeFileSync(join(dir, '.lock'), 'not a pid');
    const taken = takeDispatchLock(dir, () => false);
    expect('refusal' in taken && taken.refusal).toContain("can't be read");
  });

  it('makes the folder when there is none', () => {
    expect(takeDispatchLock(join(dir, 'nested', 'dispatch'), () => true)).toHaveProperty('release');
  });
});
