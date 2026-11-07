import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRegularFile } from './safe-read.ts';

function clone(): { dir: string; secret: string } {
  const root = mkdtempSync(join(tmpdir(), 'lzp-safe-'));
  const secret = join(root, 'secret.txt');
  writeFileSync(secret, 'TOP SECRET');
  const dir = join(root, 'clone');
  mkdirSync(join(dir, '.lzp'), { recursive: true });
  return { dir, secret };
}

describe('readRegularFile', () => {
  it('reads a plain file inside the folder', () => {
    const { dir } = clone();
    writeFileSync(join(dir, '.lzp', 'pr.md'), 'Closes #7');
    expect(readRegularFile(join(dir, '.lzp'), 'pr.md', 1024).toString()).toBe('Closes #7');
  });

  it('refuses a symlinked file, a symlinked folder and a hard link', () => {
    const a = clone();
    symlinkSync(a.secret, join(a.dir, '.lzp', 'pr.md'));
    expect(() => readRegularFile(join(a.dir, '.lzp'), 'pr.md', 1024)).toThrow(/regular file/);

    const b = clone();
    const elsewhere = join(b.dir, '..', 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'pr.md'), 'TOP SECRET');
    symlinkSync(elsewhere, join(b.dir, '.lzp2'));
    expect(() => readRegularFile(join(b.dir, '.lzp2'), 'pr.md', 1024)).toThrow(/folder/);

    const c = clone();
    linkSync(c.secret, join(c.dir, '.lzp', 'pr.md'));
    expect(() => readRegularFile(join(c.dir, '.lzp'), 'pr.md', 1024)).toThrow(/link/);
  });

  it('refuses names with a path in them and files over the limit', () => {
    const { dir } = clone();
    writeFileSync(join(dir, '.lzp', 'big.md'), 'x'.repeat(2000));
    expect(() => readRegularFile(join(dir, '.lzp'), '../x', 1024)).toThrow(/name/);
    expect(() => readRegularFile(join(dir, '.lzp'), 'big.md', 1024)).toThrow(/large/);
  });
});
