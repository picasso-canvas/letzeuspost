import { describe, expect, it } from 'vitest';
import { parseThemeChoice, resolveTheme, THEME_CHOICES } from '@lzp/ui/lib/theme';

describe('resolveTheme (light and dark follow the system, §05)', () => {
  it('follows the system when the choice is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('keeps an explicit choice whatever the system says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('offers exactly light, dark and system', () => {
    expect(THEME_CHOICES).toEqual(['light', 'dark', 'system']);
  });
});

describe('parseThemeChoice', () => {
  it('accepts each choice as written', () => {
    for (const choice of THEME_CHOICES) expect(parseThemeChoice(choice)).toBe(choice);
  });

  it('falls back to the system for anything else (a stale URL or storage value)', () => {
    for (const value of [undefined, null, '', 'Dark', 'sepia', 3, {}])
      expect(parseThemeChoice(value)).toBe('system');
  });
});
