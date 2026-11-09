/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { applyState, loadStories, openStory, THEMES } from './gallery.ts';

// §05 and §21: nothing moves when the system asks for reduced motion. In the browser, with the preference on: no
// animation or transition runs (also right after a hover or a Tab), and no element has a duration that could start one.
const stories = loadStories();

interface Moving {
  running: number;
  durations: string[];
}

/** What could move: animations the document is running now, and elements that carry an animation or transition time. */
async function motion(page: Page): Promise<Moving> {
  return page.evaluate(() => {
    const durations: string[] = [];
    for (const el of document.querySelectorAll('#storybook-root, #storybook-root *')) {
      const style = getComputedStyle(el);
      const times = [...style.transitionDuration.split(','), ...style.animationDuration.split(',')];
      const named = style.animationName.split(',').some((name) => name.trim() !== 'none');
      if (
        times.some((t) => Number.parseFloat(t) > 0) &&
        (named || style.transitionProperty !== 'none')
      )
        durations.push(
          `${el.tagName.toLowerCase()}: ${style.transitionProperty} ${style.transitionDuration} ${style.animationName} ${style.animationDuration}`,
        );
    }
    const root = document.querySelector('#storybook-root');
    // Only the story's own animations: Storybook's loader and error screens are not the interface.
    const running = document.getAnimations().filter((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return target !== null && root?.contains(target) === true;
    });
    return { running: running.length, durations };
  });
}

test.describe('reduced motion asked for', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const story of stories) {
    for (const theme of THEMES) {
      test(`nothing animates in ${story.title} › ${story.name} (${theme})`, async ({ page }) => {
        await openStory(page, story.id, theme);
        await applyState(page, story.tags);
        expect(await motion(page)).toEqual({ running: 0, durations: [] });
      });
    }
  }
});

// The same check must be able to fail: with no preference, the loading buttons spin.
test.describe('no preference', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the loading spinner does animate, so the check above can see motion', async ({ page }) => {
    const loading = stories.find((s) => s.title === 'Components/Button' && s.name === 'Loading');
    expect(loading).toBeDefined();
    await openStory(page, loading?.id ?? '', 'light');
    const moving = await motion(page);
    expect(moving.running).toBeGreaterThan(0);
    expect(moving.durations.length).toBeGreaterThan(0);
  });
});
