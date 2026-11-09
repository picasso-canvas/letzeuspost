import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cn } from '@lzp/ui/lib/utils';

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

  it("lets a later size replace an earlier one, DESIGN.md's or Tailwind's", () => {
    expect(cn('text-label', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-label')).toBe('text-label');
  });

  it("treats each of DESIGN.md's weights as a font weight that a later weight replaces", () => {
    const weights = namesOf('font-weight');
    expect(weights).toContain('button');
    for (const weight of weights)
      expect(cn(`font-${weight}`, 'font-bold'), weight).toBe('font-bold');
    expect(cn('font-medium', 'font-button')).toBe('font-button');
  });
});
