/** The choices a theme switch offers: "system" follows the device (§05: light and dark, following the system). */
export const THEME_CHOICES = ['light', 'dark', 'system'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type Theme = 'light' | 'dark';

/** The theme to draw: an explicit choice wins, "system" takes the device's `prefers-color-scheme`. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}
