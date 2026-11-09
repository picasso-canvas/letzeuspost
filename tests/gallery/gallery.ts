/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Shared by the component gallery's tests (#74): which stories exist, how to open one in a theme and put it in its
// state, and the token colours the checks compare with. The tests run against the built Storybook
// (`pnpm --filter @lzp/ui build-storybook`, then `pnpm exec playwright test --project gallery`).

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export interface Story {
  id: string;
  title: string;
  name: string;
  tags: string[];
}

const gallery = new URL('../../packages/ui/storybook-static/', import.meta.url);

/** Every story in the built gallery (its index.json), so a new story is tested without touching the tests. */
export function loadStories(): Story[] {
  let raw: string;
  try {
    raw = readFileSync(new URL('index.json', gallery), 'utf8');
  } catch {
    throw new Error('No built gallery: run `pnpm --filter @lzp/ui build-storybook` first.');
  }
  const index = JSON.parse(raw) as { entries: Record<string, Story & { type: string }> };
  const stories = Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map(({ id, title, name, tags }) => ({ id, title, name, tags }));
  if (stories.length === 0) throw new Error('The built gallery has no stories.');
  return stories;
}

/** Opens one story, alone, in a theme, with Inter loaded and nothing left to render. */
export async function openStory(page: Page, id: string, theme: Theme): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
  await page.locator('[data-gallery-canvas]').waitFor();
  // The decorator sets the class before the story draws; check it took, so a broken switch fails loudly.
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains('dark') === dark,
    theme === 'dark',
  );
  await page.evaluate(() => document.fonts.ready);
}

/** Puts the story in the state its tag names: `hover` is a real pointer, `focus` a real Tab key press. */
export async function applyState(page: Page, tags: string[]): Promise<void> {
  if (tags.includes('hover')) {
    await page.locator('#storybook-root').locator('button, input').first().hover();
  }
  if (tags.includes('focus')) {
    await page.keyboard.press('Tab');
    // Tab into a text field selects its text, and the browser's blue selection would be frozen into the baseline.
    // Put the caret at the end instead, as when someone clicks after the last letter.
    await page.locator(':focus-visible').evaluate((el) => {
      if (el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length);
    });
  }
}

const tokenFiles = {
  light: readFileSync(new URL('../../packages/ui/src/tokens/theme.css', import.meta.url), 'utf8'),
  dark: readFileSync(new URL('../../packages/ui/src/tokens/dark.css', import.meta.url), 'utf8'),
};

/** A generated colour token as the browser reports it (`rgb(28, 26, 23)`), so no hex is copied into a test. */
export function tokenColor(theme: Theme, name: string): string {
  const hex = new RegExp(`--color-${name}:\\s*#([0-9a-f]{6});`, 'i').exec(tokenFiles[theme])?.[1];
  if (hex === undefined) throw new Error(`No --color-${name} in the ${theme} tokens.`);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}
