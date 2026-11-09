/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { openStory, THEMES, tokenColor } from './gallery.ts';

// DESIGN.md's type tokens, checked on computed styles in the browser: button text is 14 px at 550, a field label is
// 12.5 px at 550. Tailwind reads `font-button` as the font *family*, so a class that looks right can leave the weight
// at 400; only the browser shows what is drawn (#74 round 3).
for (const theme of THEMES) {
  test(`${theme}: button text is 14 px at weight 550`, async ({ page }) => {
    await openStory(page, 'components-button--variants', theme);
    const buttons = page.locator('#storybook-root button');
    expect(await buttons.count()).toBe(4);
    for (const button of await buttons.all()) {
      const style = await button.evaluate((el) => {
        const { fontWeight, fontSize } = getComputedStyle(el);
        return { fontWeight, fontSize };
      });
      expect(style).toEqual({ fontWeight: '550', fontSize: '14px' });
    }
  });

  test(`${theme}: a field label is 12.5 px at weight 550, in the muted colour`, async ({
    page,
  }) => {
    await openStory(page, 'components-input--empty', theme);
    const style = await page.locator('#storybook-root label').evaluate((el) => {
      const { fontWeight, fontSize, color } = getComputedStyle(el);
      return { fontWeight, fontSize, color };
    });
    expect(style).toEqual({
      fontWeight: '550',
      fontSize: '12.5px',
      color: tokenColor(theme, 'muted-foreground'),
    });
  });
}
