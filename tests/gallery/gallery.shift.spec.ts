/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loadStories, openStory, THEMES } from './gallery.ts';

// "A visual test fails on a 4 px shift" (§21 Done when): the gallery's screenshot comparison, run on a story whose
// control is moved 4 px, must not match the story's baseline. Like gallery.visual.spec.ts it compares only once Athena
// has committed the story's approved baseline (Q11); until then it records that it has nothing to compare with.
const SHIFTED = ['components-button--variants', 'components-input--empty'];
const stories = loadStories().filter((story) => SHIFTED.includes(story.id));

test('the shift check covers a button and an input', () => {
  expect(stories.map((story) => story.id).sort()).toEqual([...SHIFTED].sort());
});

for (const story of stories) {
  for (const theme of THEMES) {
    test(`a 4 px shift fails the screenshot: ${story.title} › ${story.name} (${theme})`, async ({
      page,
    }, testInfo) => {
      await openStory(page, story.id, theme);
      const name = `${story.id}-${theme}.png`;
      if (!existsSync(testInfo.snapshotPath(name))) {
        testInfo.annotations.push({
          type: 'first baseline',
          description: 'No approved baseline yet (Q11), so there is nothing to shift against.',
        });
        return;
      }
      const control = page.locator('#storybook-root').locator('button, input').first();
      // The same component, 4 px to the right: nothing else changes.
      await control.evaluate((el) => {
        el.style.translate = '4px 0';
      });
      await expect(page.locator('[data-gallery-canvas]')).not.toHaveScreenshot(name);
    });
  }
}
