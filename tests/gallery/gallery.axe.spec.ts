import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { applyState, loadStories, openStory, THEMES } from './gallery.ts';

// axe on every story in both themes: no serious or critical issues (§21, WCAG 2.2 AA). Every rule runs, not only the
// WCAG-tagged ones; only the impact decides.
//
// One exclusion, and only this one (Zeus, #205, 2026-11-11): Base UI's focus guards. Every open menu puts invisible
// `tabindex="0" aria-hidden` sentinels around it that hand focus straight on, which axe's `aria-hidden-focus` flags.
// gallery.focus-guard.spec.ts proves they never keep focus.
const FOCUS_GUARD = '[data-base-ui-focus-guard]';

for (const story of loadStories()) {
  for (const theme of THEMES) {
    test(`axe: ${story.title} › ${story.name} (${theme})`, async ({ page }) => {
      await openStory(page, story.id, theme);
      await applyState(page, story.tags);
      const { violations } = await new AxeBuilder({ page }).exclude(FOCUS_GUARD).analyze();
      const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        blocking.map((v) => ({
          rule: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
        })),
      ).toEqual([]);
    });
  }
}
