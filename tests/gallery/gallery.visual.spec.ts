/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { applyState, loadStories, openStory, THEMES } from './gallery.ts';

// A screenshot of every story in both themes (§21 Visual tests). They run in the CI image, so fonts and the browser are
// the same every time.
//
// Baselines (Q11): CI renders the screenshots and uploads them (`gallery-screenshots`); Iris and Zeus approve the
// first ones; then Athena commits them to tests/visual/approved/. A builder never writes that folder. Until a story
// has its baseline there is nothing to compare with, so its screenshot is only taken (and annotated, and uploaded).
// From the commit that adds the baseline, the comparison is strict: any changed pixel fails.
const stories = loadStories();

for (const story of stories) {
  for (const theme of THEMES) {
    test(`screenshot: ${story.title} › ${story.name} (${theme})`, async ({ page }, testInfo) => {
      await openStory(page, story.id, theme);
      await applyState(page, story.tags);
      const canvas = page.locator('[data-gallery-canvas]');
      const name = `${story.id}-${theme}.png`;
      if (existsSync(testInfo.snapshotPath(name))) {
        await expect(canvas).toHaveScreenshot(name);
      } else {
        await canvas.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
        testInfo.annotations.push({
          type: 'first baseline',
          description: 'Rendered for approval (Q11); no baseline to compare with yet.',
        });
      }
    });
  }
}

// "A visual test fails on a 4 px shift" (§21 Done when): a story whose control is moved 4 px must not match its
// baseline. The same stories and baselines as above, so it needs no baseline of its own; it compares once they exist.
const SHIFTED = ['components-button--variants', 'components-input--empty'];

test('the shift check covers a button and an input', () => {
  const ids = stories.map((story) => story.id);
  for (const id of SHIFTED) expect(ids).toContain(id);
});

for (const story of stories.filter((s) => SHIFTED.includes(s.id))) {
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
