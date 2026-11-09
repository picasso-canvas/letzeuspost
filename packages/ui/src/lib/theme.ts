/** The choices a theme switch offers: "system" follows the device (§05: light and dark, following the system). */
export const THEME_CHOICES = ['light', 'dark', 'system'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type Theme = 'light' | 'dark';

/** A stored, URL or toolbar value as a choice: anything that isn't one follows the system. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return THEME_CHOICES.find((choice) => choice === value) ?? 'system';
}

/** The theme to draw: an explicit choice wins, "system" takes the device's `prefers-color-scheme`. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}
