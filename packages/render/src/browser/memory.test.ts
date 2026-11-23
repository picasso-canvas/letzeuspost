import { describe, expect, it } from 'vitest';
import { residentBytes } from './memory.ts';

const status = (kb: number) =>
  `Name:\tchrome\nVmPeak:\t  999999 kB\nVmRSS:\t ${String(kb)} kB\nThreads:\t12\n`;

describe('residentBytes: the memory the browser’s processes hold', () => {
  it('adds up the resident memory of every process', async () => {
    const files: Record<number, string> = { 10: status(2048), 11: status(1024) };
    const bytes = await residentBytes([10, 11], (pid) => {
      const text = files[pid];
      return text === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(text);
    });
    expect(bytes).toBe(3072 * 1024);
  });

  it('skips a process that has gone, and knows nothing when it can read none', async () => {
    const read = (pid: number) =>
      pid === 10 ? Promise.resolve(status(4)) : Promise.reject(new Error('gone'));
    expect(await residentBytes([10, 12], read)).toBe(4096);
    expect(await residentBytes([12], read)).toBeUndefined();
    expect(await residentBytes([], read)).toBeUndefined();
    expect(await residentBytes([10], () => Promise.resolve('Name:\tchrome\n'))).toBeUndefined();
  });
});
