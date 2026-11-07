import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pidsUnder, pidsWithMarker, takeHandover } from './handover.ts';

function setup(): { clone: string; taken: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'lzp-handover-'));
  const clone = join(root, 'builders', '7-thing');
  mkdirSync(clone, { recursive: true });
  return { clone, taken: join(root, 'state', 'ship', '7'), root };
}

describe('takeHandover', () => {
  it("moves the clone's .lzp into Athena's state, out of every builder process's reach", () => {
    const { clone, taken } = setup();
    mkdirSync(join(clone, '.lzp'));
    writeFileSync(join(clone, '.lzp', 'pr.md'), 'Closes #7');
    expect(takeHandover(clone, taken)).toBe(taken);
    expect(existsSync(join(clone, '.lzp'))).toBe(false);
    expect(readFileSync(join(taken, 'pr.md'), 'utf8')).toBe('Closes #7');
  });

  it('refuses a .lzp that is a link, without touching what it points at', () => {
    const { clone, taken, root } = setup();
    const secrets = join(root, 'home', '.ssh');
    mkdirSync(secrets, { recursive: true });
    writeFileSync(join(secrets, 'pr.md'), 'TOP SECRET');
    symlinkSync(secrets, join(clone, '.lzp'));
    expect(() => takeHandover(clone, taken)).toThrow(/link/);
    expect(existsSync(taken)).toBe(false);
    expect(readFileSync(join(secrets, 'pr.md'), 'utf8')).toBe('TOP SECRET');
  });

  it('reuses a hand-over it already took (a dry run, a refusal), and says when there is none', () => {
    const { clone, taken } = setup();
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, 'pr.md'), 'Closes #7');
    expect(takeHandover(clone, taken)).toBe(taken);
    const other = setup();
    expect(() => takeHandover(other.clone, other.taken)).toThrow(/no hand-over/);
  });

  it('refuses a taken folder that is a link', () => {
    const { clone, taken, root } = setup();
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    mkdirSync(join(taken, '..'), { recursive: true });
    symlinkSync(elsewhere, taken);
    expect(() => takeHandover(clone, taken)).toThrow(/link/);
  });
});

describe('pidsUnder', () => {
  const lsof = [
    'p100',
    'fcwd',
    'n/Users/p/letzeuspost-builders/7-thing',
    'p200',
    'fcwd',
    'n/',
    'f3',
    'n/Users/p/letzeuspost-builders/7-thing/.lzp/pnpm/store/x',
    'p300',
    'fcwd',
    'n/Users/p/letzeuspost-builders/7-thing-other',
    'p400',
    'fcwd',
    'n/Users/p/letzeuspost-builders/7-thing',
    '',
  ].join('\n');

  it('finds every process whose working folder or an open file is in the clone, never itself', () => {
    expect(pidsUnder(lsof, '/Users/p/letzeuspost-builders/7-thing', 400)).toEqual([100, 200]);
  });
});

describe('pidsWithMarker', () => {
  const marker = 'a'.repeat(32);
  const ps = [
    `  101 node build.js PATH=/bin LZP_DISPATCH=${marker} HOME=/h`,
    `  102 sleep 300 LZP_DISPATCH=${'b'.repeat(32)}`,
    `  103 sh -c x LZP_DISPATCH=${marker}0`,
    `  104 node dispatch.ts LZP_DISPATCH=${marker}`,
    '  105 vim',
    '',
  ].join('\n');

  it("finds processes carrying this dispatch's marker in their environment, never itself", () => {
    expect(pidsWithMarker(ps, marker, 104)).toEqual([101]);
  });

  it('refuses a marker too short to be unique', () => {
    expect(() => pidsWithMarker(ps, 'abc', 1)).toThrow(/marker/);
  });
});
