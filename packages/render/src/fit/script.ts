// The fit script (§08 The fit check): runs inside the page, after the fonts are loaded and the images decoded, and
// finds the largest `--k` between 1.00 and 0.85 at which every text block stays inside the text area and no line is
// wider than its block. It is the one script the content policy allows, by its hash, so it is plain code: no eval, no
// inline style attribute (it sets variables and properties through the CSS object model, which the policy leaves
// alone) and no timer; it waits on promises, never on a delay.
//
// What it does, in order:
//   1. waits for `document.fonts` to load and `document.images` to decode (a failure is left to the runner, which
//      fails the render for a font by name; here a failed load only ends the wait),
//   2. steps `--k` down from 1.00 by 0.01 to 0.85 and stops at the first `k` where the page fits: every block of the
//      text area (the box, not the glyph ink) lies inside the text area's box with half a pixel to spare, no block's
//      longest line is wider than the block, and every `.image-box` is at least 26% of the page's height. Body text
//      holds its floor and small print is a fixed 28 px in the CSS, so `--k` is all that changes,
//   3. when nothing fits, stays at 0.85 and names the blocks to shorten,
//   4. publishes the result as `window.lzpFit` (a promise of `{ k, fits, fields }`) and sets `data-fit="done"` on
//      `<html>`, so whoever draws the page knows when it is.
//
// The numbers it returns are boxes in pixels. Grapheme counts and target lengths are made by the caller
// (`fit/report.ts`), from the post's own text and the worker's pinned ICU.
//
/** An image box keeps at least this share of the page's height, so text can't squeeze a photo away (§08). */
export const IMAGE_BOX_MIN_SHARE = 0.26;

// A string, not a function, so the text that is hashed and served is the text that is written here.
export const FIT_SCRIPT = `(() => {
  'use strict';
  const TEXT_BLOCKS = ['kicker', 'title', 'body', 'source'];
  const SHORTENABLE = ['kicker', 'title', 'body'];
  const STEPS_FROM = 100;
  const STEPS_TO = 85;
  const IMAGE_BOX_SHARE = ${String(IMAGE_BOX_MIN_SHARE)};
  const SLACK = 0.5;
  const WIDTH_SLACK = 1;

  const root = document.documentElement;
  const textArea = document.querySelector('.text-area');
  const round = (value) => Math.round(value * 100) / 100;
  const clamp = (value) => Math.min(1, Math.max(0, value));
  const sum = (values) => values.reduce((total, value) => total + value, 0);

  const settle = async () => {
    await Promise.allSettled([...document.fonts].map((face) => face.load()));
    await document.fonts.ready;
    await Promise.allSettled([...document.images].map((image) => image.decode()));
  };

  const lineHeight = (element) => {
    const style = getComputedStyle(element);
    const height = parseFloat(style.lineHeight);
    return Number.isFinite(height) && height > 0 ? height : parseFloat(style.fontSize) * 1.2;
  };

  const measureBlocks = () =>
    [...textArea.querySelectorAll(TEXT_BLOCKS.map((name) => '.' + name).join(', '))].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        element,
        name: TEXT_BLOCKS.find((name) => element.classList.contains(name)),
        box,
        lines: Math.max(1, Math.round(box.height / lineHeight(element))),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });

  const widthOver = (block) => Math.max(0, block.scrollWidth - block.clientWidth);

  const inspect = (k) => {
    root.style.setProperty('--k', String(k));
    const area = textArea.getBoundingClientRect();
    const blocks = measureBlocks();
    const outside = blocks.some(
      ({ box }) =>
        box.top < area.top - SLACK ||
        box.bottom > area.bottom + SLACK ||
        box.left < area.left - SLACK ||
        box.right > area.right + SLACK,
    );
    const tooWide = blocks.some((block) => widthOver(block) > WIDTH_SLACK);
    const pageHeight = document.body.getBoundingClientRect().height;
    const squeezed = [...document.querySelectorAll('.image-box')].some(
      (box) => box.getBoundingClientRect().height < IMAGE_BOX_SHARE * pageHeight - SLACK,
    );
    return { fits: !outside && !tooWide && !squeezed, area, blocks };
  };

  // The blocks to shorten, from a measurement that doesn't fit. Blocks sharing a column or the text area share its
  // room. Of the text that can be shortened, the blocks with more than one line can give back height (a one-line
  // block can't), and they share the overflow by their height: cut to their targets, the text fits. A block whose
  // line is wider than the block is named for its width, small print included.
  const fieldsToShorten = ({ area, blocks }) => {
    const groups = new Map();
    for (const block of blocks) {
      const container = block.element.closest('.col') ?? textArea;
      groups.set(container, [...(groups.get(container) ?? []), block]);
    }
    const named = new Map();
    for (const [container, members] of groups) {
      const boxes = [...container.children].map((child) => child.getBoundingClientRect());
      const needed = Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top));
      const shortenable = members.filter((block) => SHORTENABLE.includes(block.name) && block.box.height > 0);
      const tall = shortenable.filter((block) => block.lines > 1);
      const share = needed - area.height > SLACK ? (tall.length > 0 ? tall : shortenable) : [];
      const together = sum(share.map((block) => block.box.height));
      const fixed = needed - together;
      for (const block of members) {
        const vertical = share.includes(block) ? clamp((area.height - fixed) / together) : 1;
        const horizontal = widthOver(block) > WIDTH_SLACK ? clamp(block.clientWidth / block.scrollWidth) : 1;
        const ratio = Math.min(vertical, horizontal);
        if (ratio === 1) continue;
        named.set(block.element, {
          name: block.name,
          lines: block.lines,
          needed: round(block.box.height),
          available: round(block.box.height * ratio),
          overflowPx: round(Math.max(block.box.height * (1 - vertical), widthOver(block))),
        });
      }
    }
    return blocks.map((block) => named.get(block.element)).filter((field) => field !== undefined);
  };

  const run = async () => {
    await settle();
    // A word wider than its block is broken mid-word by the page's CSS (overflow-wrap), which would hide it: measure
    // with that off, and put it back when done.
    const blocks = [...textArea.querySelectorAll(TEXT_BLOCKS.map((name) => '.' + name).join(', '))];
    for (const element of blocks) element.style.setProperty('overflow-wrap', 'normal');
    let measured;
    let k = STEPS_FROM / 100;
    try {
      for (let step = STEPS_FROM; step >= STEPS_TO; step -= 1) {
        k = step / 100;
        measured = inspect(k);
        if (measured.fits) break;
      }
      const fits = measured.fits;
      return { k, fits, fields: fits ? [] : fieldsToShorten(measured) };
    } finally {
      for (const element of blocks) element.style.removeProperty('overflow-wrap');
    }
  };

  window.lzpFit = run().then(
    (result) => {
      root.dataset.fit = 'done';
      root.dataset.fitK = String(result.k);
      return result;
    },
    (error) => {
      root.dataset.fit = 'error';
      throw error;
    },
  );
})();`;
