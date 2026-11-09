import { describe, expect, it } from 'vitest';
import { resolveTheme, THEME_CHOICES } from '@lzp/ui/lib/theme';

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
