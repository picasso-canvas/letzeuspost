/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { applyState, openStory, THEMES } from './gallery.ts';

// #75, PR #219's round 1 (Argus F2, F3): what the unit tests can only read from the markup, checked in the browser
// with a real keyboard and on computed styles, in both themes.
const SWITCHER = '#storybook-root button[aria-haspopup="menu"]';

for (const theme of THEMES) {
  test.describe(theme, () => {
    test('the switcher opens, moves, chooses and gives focus back, by the keyboard alone', async ({
      page,
    }) => {
      // The story's own steps: Tab to the button, ArrowDown to open (the first workspace is focused).
      await openStory(page, 'components-top-bar--keyboard-open', theme);
      await applyState(page, ['focus', 'keyboard-open']);
      const trigger = page.locator(SWITCHER);
      await expect(trigger).toContainText('Northwind Social');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');

      // Every workspace is listed with the person's role, and the current one is marked.
      const items = page.getByRole('menuitem');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toContainText('Admin · current');
      await expect(items.nth(0)).toHaveAttribute('aria-current', 'true');
      await expect(items.nth(1)).toContainText('Kite & Co');
      await expect(items.nth(1)).toContainText('Editor');
      await expect(items.nth(2)).toContainText('Viewer');
      await expect(items.nth(1)).not.toHaveAttribute('aria-current', 'true');
      await expect(items.nth(0)).toBeFocused();

      // ArrowDown moves to the next, Enter chooses it: the story's selection changes and the menu closes.
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(trigger).toContainText('Kite & Co');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(items).toHaveCount(0);
      // Focus is back on the button, so the next key press is the person's, not lost.
      await expect(trigger).toBeFocused();

      // And the new workspace is the one marked when it is opened again.
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem').nth(1)).toHaveAttribute('aria-current', 'true');
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });

    test('the workspace’s name is at weight 600 on the button, and its mark has its own colours', async ({
      page,
    }) => {
      await openStory(page, 'components-top-bar--default', theme);
      const name = page.locator(SWITCHER).locator('span').filter({ hasText: 'Northwind Social' });
      expect(await name.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600');
      const mark = page.locator(`${SWITCHER} [data-slot="avatar-fallback"]`);
      const colours = await mark.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.backgroundColor, style.color];
      });
      expect(colours).toEqual(['rgb(35, 57, 91)', 'rgb(255, 255, 255)']);
    });

    test('every sidebar nav item is at the body weight, 400, the current page included', async ({
      page,
    }) => {
      await openStory(page, 'components-sidebar--expanded', theme);
      const buttons = page.locator('[data-slot="sidebar-menu-button"]');
      expect(await buttons.count()).toBeGreaterThan(3);
      const weights = await buttons.evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).fontWeight),
      );
      expect(new Set(weights)).toEqual(new Set(['400']));
      // The current page is among them, marked by its 2 px bar and nothing else.
      const current = page.locator('[data-slot="sidebar-menu-button"][data-active]');
      await expect(current).toHaveCount(1);
      expect(await current.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(
        / 2px 0px 0px 0px inset$/,
      );
    });

    test('below 900 px the sidebar is a row that scrolls sideways; at its full width it is a column', async ({
      page,
    }) => {
      const sidebar = page.locator('[data-slot="sidebar"]');
      await openStory(page, 'components-sidebar--narrow-row', theme);
      const narrow = await sidebar.evaluate((el) => {
        const style = getComputedStyle(el);
        return [
          style.flexDirection,
          style.overflowX,
          style.borderRightWidth,
          style.borderBottomWidth,
        ];
      });
      expect(narrow).toEqual(['row', 'auto', '0px', '1px']);
      // The current page's bar is under its link, not beside it.
      const current = page.locator('[data-slot="sidebar-menu-button"][data-active]');
      expect(await current.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(
        / 0px -2px 0px 0px inset$/,
      );

      await openStory(page, 'components-sidebar--expanded', theme);
      expect(await sidebar.evaluate((el) => getComputedStyle(el).flexDirection)).toBe('column');
    });
  });
}
