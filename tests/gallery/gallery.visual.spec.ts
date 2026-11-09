import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { applyState, loadStories, openStory, THEMES } from './gallery.ts';

// A screenshot of every story in both themes (§21 Visual tests). They run in the CI image, so fonts and the browser are
// the same every time.
//
// Baselines (Q11): CI renders the screenshots and uploads them (`gallery-screenshots`); Iris and Zeus approve the
// first ones; then Athena commits them to tests/visual/approved/. A builder never writes that folder. Until a story
// has its baseline there is nothing to compare with, so its screenshot is only taken (and annotated, and uploaded).
// From the commit that adds the baseline, the comparison is strict: any changed pixel fails, a 4 px shift included.
for (const story of loadStories()) {
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
