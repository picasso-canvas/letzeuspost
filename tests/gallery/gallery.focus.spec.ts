/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { applyState, loadStories, openStory, THEMES, tokenColor } from './gallery.ts';

// §21 "Design finding": gold on white is 1.9:1, so in light mode focus rings, borders, outlines and text are never
// gold: the focus ring is ink (or deep amber). Gold is a fill. Dark mode uses gold for the ring. Checked on computed
// styles, in the browser, against the generated tokens.
const stories = loadStories();
const focusStories = stories.filter((story) => story.tags.includes('focus'));

test('the gallery has focus stories to check', () => {
  expect(focusStories.length).toBeGreaterThan(0);
});

test('light: the ring token is ink or deep amber, never gold; dark: it is gold', () => {
  const ring = tokenColor('light', 'ring');
  expect([tokenColor('light', 'foreground'), tokenColor('light', 'accent-text')]).toContain(ring);
  expect(ring).not.toBe(tokenColor('light', 'primary'));
  expect(tokenColor('dark', 'ring')).toBe(tokenColor('dark', 'primary'));
});

interface Drawn {
  tag: string;
  what: string;
  colour: string;
}

/** Every colour the canvas draws as an outline, a border, a ring (box shadow) or text, per element. */
async function drawnColours(page: Page): Promise<Drawn[]> {
  return page.locator('[data-gallery-canvas]').evaluate((canvas) => {
    const drawn: Drawn[] = [];
    for (const el of [canvas, ...canvas.querySelectorAll('*')]) {
      const style = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      if (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
        drawn.push({ tag, what: 'outline', colour: style.outlineColor });
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        if (
          style[`border${side}Style`] !== 'none' &&
          Number.parseFloat(style[`border${side}Width`]) > 0
        )
          drawn.push({ tag, what: `border-${side}`, colour: style[`border${side}Color`] });
      }
      if (style.boxShadow !== 'none') drawn.push({ tag, what: 'ring', colour: style.boxShadow });
      drawn.push({ tag, what: 'text', colour: style.color });
    }
    return drawn;
  });
}

for (const story of stories) {
  test(`light: no gold outline, border, ring or text in ${story.title} › ${story.name}`, async ({
    page,
  }) => {
    await openStory(page, story.id, 'light');
    await applyState(page, story.tags);
    const gold = tokenColor('light', 'primary');
    const drawn = await drawnColours(page);
    expect(drawn.length).toBeGreaterThan(0);
    // A ring is a box-shadow string that may carry the colour among other values.
    expect(drawn.filter((d) => d.colour.includes(gold))).toEqual([]);
  });
}

// Tabbing into a field selects its text, and the browser's blue selection would be frozen into the baseline.
for (const story of focusStories) {
  test(`focus leaves no text selected in ${story.title} › ${story.name}`, async ({ page }) => {
    await openStory(page, story.id, 'light');
    await applyState(page, story.tags);
    const selected = await page.locator(':focus-visible').evaluate((el) => {
      if (!(el instanceof HTMLInputElement)) return 0;
      return Math.abs((el.selectionEnd ?? 0) - (el.selectionStart ?? 0));
    });
    expect(selected).toBe(0);
  });
}

for (const theme of THEMES) {
  for (const story of focusStories) {
    test(`${theme}: focus is a solid 2 px outline with a 2 px gap in ${story.title} › ${story.name}`, async ({
      page,
    }) => {
      await openStory(page, story.id, theme);
      await applyState(page, story.tags);
      const focused = page.locator(':focus-visible');
      await expect(focused).toHaveCount(1);
      const outline = await focused.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          style: style.outlineStyle,
          width: style.outlineWidth,
          offset: style.outlineOffset,
          colour: style.outlineColor,
        };
      });
      expect(outline).toEqual({
        style: 'solid',
        width: '2px',
        offset: '2px',
        colour: tokenColor(theme, 'ring'),
      });
    });
  }
}
