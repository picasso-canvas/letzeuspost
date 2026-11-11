/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { applyState, loadStories, openStory, THEMES } from './gallery.ts';

// Base UI puts invisible focus guards (`[data-base-ui-focus-guard]`, `tabindex="0" aria-hidden`) around every open
// menu, and the axe test skips them (Zeus, #205, 2026-11-11). That is only safe if a guard never keeps focus: it must
// hand focus straight on. Here, from each open menu, in both themes, Tab and Shift+Tab must never leave focus on one.
const GUARD = '[data-base-ui-focus-guard]';
const ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const openMenus = loadStories().filter(
  (story) =>
    story.title === 'Components/Dropdown menu' &&
    ['Open', 'Keyboard Open', 'Checkbox And Radio'].includes(story.name),
);

test('the open-menu stories are all there to check', () => {
  expect(openMenus.map((story) => story.name).sort()).toEqual([
    'Checkbox And Radio',
    'Keyboard Open',
    'Open',
  ]);
});

/** Lets the guards' own focus moves (some wait a frame) finish. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 50);
          });
        });
      }),
  );
}

for (const story of openMenus) {
  for (const theme of THEMES) {
    for (const key of ['Tab', 'Shift+Tab']) {
      test(`${theme}: ${key} from ${story.title} › ${story.name} never leaves focus on a focus guard`, async ({
        page,
      }) => {
        await openStory(page, story.id, theme);
        await applyState(page, story.tags);
        // Focus is in the menu, as a keyboard user's is (a keyboard-opened story already put it there).
        const items = page.locator(ITEM);
        await expect(items.first()).toBeVisible();
        if (!story.tags.includes('keyboard-open')) await items.first().focus();
        expect(await page.evaluate((item) => document.activeElement?.matches(item), ITEM)).toBe(
          true,
        );
        // The open menu really has guards, so this test can't pass for want of them.
        expect(await page.locator(GUARD).count()).toBeGreaterThan(0);

        await page.keyboard.press(key);
        await settle(page);

        const focused = await page.evaluate(
          (guard) => ({
            onGuard: document.activeElement?.matches(guard) ?? false,
            tag: document.activeElement?.tagName.toLowerCase() ?? null,
          }),
          GUARD,
        );
        expect(focused.tag).not.toBeNull();
        expect(focused.onGuard).toBe(false);
      });
    }
  }
}
