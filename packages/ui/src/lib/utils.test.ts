import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cn, typeSizes } from '@lzp/ui/lib/utils';

const theme = readFileSync(new URL('../tokens/theme.css', import.meta.url), 'utf8');
const namesOf = (prefix: string): string[] =>
  [...theme.matchAll(new RegExp(`--${prefix}-([a-z0-9]+):`, 'g'))].map((m) => m[1] ?? '');

describe('cn', () => {
  it('lets a later Tailwind class win over an earlier one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it("keeps each of DESIGN.md's type sizes next to a text colour: a size isn't a colour", () => {
    const sizes = namesOf('text');
    expect(sizes).toContain('label');
    for (const size of sizes)
      expect(cn(`text-${size}`, 'text-muted-foreground'), size).toBe(
        `text-${size} text-muted-foreground`,
      );
  });

  it("lists exactly DESIGN.md's type sizes: none missing, none extra", () => {
    // A name missing from the list lets `text-<name>` be dropped as a colour; an extra one makes a class that isn't
    // a size (a real colour called `text-x`) survive next to a size. Either way the list and the tokens must match.
    expect([...typeSizes].sort()).toEqual([...namesOf('text')].sort());
  });

  it("lets a later size replace an earlier one, DESIGN.md's or Tailwind's", () => {
    expect(cn('text-label', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-label')).toBe('text-label');
  });

  it("lets DESIGN.md's weight, asked for by type, replace Tailwind's and be replaced by it", () => {
    expect(cn('font-medium', 'font-(weight:--font-weight-button)')).toBe(
      'font-(weight:--font-weight-button)',
    );
    expect(cn('font-(weight:--font-weight-label)', 'font-bold')).toBe('font-bold');
  });
});
