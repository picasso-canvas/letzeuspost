/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { applyState, openStory, THEMES, tokenColor } from './gallery.ts';

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

  test(`${theme}: a field label keeps its colour when the field is focused`, async ({ page }) => {
    await openStory(page, 'components-input--focus', theme);
    await applyState(page, ['focus']);
    expect(
      await page.locator('#storybook-root input').evaluate((el) => el === document.activeElement),
    ).toBe(true);
    const color = await page
      .locator('#storybook-root label')
      .evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(tokenColor(theme, 'muted-foreground'));
  });

  for (const id of ['empty', 'filled', 'focus', 'disabled', 'loading', 'error-state']) {
    test(`${theme}: the help text is 13 px in the faint colour, undimmed (${id})`, async ({
      page,
    }) => {
      await openStory(page, `components-input--${id}`, theme);
      const style = await page
        .locator('#storybook-root [data-slot="field-description"]')
        .evaluate((el) => {
          const { fontSize, color, opacity } = getComputedStyle(el);
          return { fontSize, color, opacity };
        });
      expect(style).toEqual({
        fontSize: '13px',
        color: tokenColor(theme, 'faint'),
        opacity: '1',
      });
    });
  }

  test(`${theme}: the placeholder is an example in the muted colour`, async ({ page }) => {
    await openStory(page, 'components-input--empty', theme);
    const input = page.locator('#storybook-root input');
    expect(await input.getAttribute('placeholder')).toBe('e.g. Golpo Café');
    expect(await input.evaluate((el) => getComputedStyle(el, '::placeholder').color)).toBe(
      tokenColor(theme, 'muted-foreground'),
    );
  });

  test(`${theme}: the destructive button has a solid destructive border`, async ({ page }) => {
    await openStory(page, 'components-button--variants', theme);
    const button = page.locator('#storybook-root button[data-slot="button"]').filter({
      hasText: 'Delete post',
    });
    const border = await button.evaluate((el) => {
      const { borderTopColor, borderTopWidth, borderTopStyle } = getComputedStyle(el);
      return { borderTopColor, borderTopWidth, borderTopStyle };
    });
    expect(border).toEqual({
      borderTopColor: tokenColor(theme, 'destructive'),
      borderTopWidth: '1px',
      borderTopStyle: 'solid',
    });
  });
}
