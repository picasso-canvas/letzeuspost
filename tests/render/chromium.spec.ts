import { chromium, expect, test } from '@playwright/test';

// The first spec of the `render` project (§08, #327): proves CI can start a Chromium of its own and draw a line of
// text. The render engine's real browser tests (#333 on) replace it.
test('Chromium starts and draws a line of text', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<p id="line">Hello, render engine</p>');
    await expect(page.locator('#line')).toHaveText('Hello, render engine');
  } finally {
    await browser.close();
  }
});
