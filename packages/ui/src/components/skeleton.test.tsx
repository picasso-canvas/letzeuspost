import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '@lzp/ui/components/skeleton';
import { buildCss } from '@lzp/ui/lib/build-css';

// §05: "a shimmer on generating cards, and nothing moves when the system asks for reduced motion". A skeleton shimmers:
// a light band sweeps across it, drawn on the compositor (`transform` only). Under reduced motion it stands still.
const classesOf = (html: string): string[] => /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];

/** The body of the first `{ … }` block that opens with `opener`, braces balanced. */
function block(css: string, opener: RegExp): string {
  const start = opener.exec(css);
  if (start === null) throw new Error(`no ${String(opener)} in the CSS`);
  let depth = 0;
  for (let i = css.indexOf('{', start.index); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start.index) + 1, i);
  }
  throw new Error(`unbalanced braces after ${String(opener)}`);
}

describe('the skeleton', () => {
  const classes = classesOf(renderToStaticMarkup(<Skeleton className="h-4 w-1/2" />));

  it('shimmers instead of pulsing, and keeps the caller’s shape', () => {
    expect(classes).toContain('skeleton-shimmer');
    expect(classes.filter((c) => /pulse/.test(c))).toEqual([]);
    expect(classes).toEqual(expect.arrayContaining(['h-4', 'w-1/2']));
  });

  it('sweeps a band across with a transform, and moves nothing else', async () => {
    const css = await buildCss(classes);
    const sweep = block(css, /@keyframes skeleton-shimmer\s*\{/);
    expect(sweep).toMatch(/transform:\s*translateX\(/);
    expect(sweep.replace(/transform:[^;]*;?/g, '').replace(/[\s{}]|to|from|\d+%/g, '')).toBe('');
    // The animation runs on the band (a pseudo-element), forever, from the keyframes above.
    const rule = block(css, /\.skeleton-shimmer\s*\{/);
    expect(rule).toMatch(/&::after|::after/);
    expect(rule).toMatch(/animation:\s*skeleton-shimmer\s+[\d.]+s[^;]*infinite/);
  });

  it('stands still when the system asks for reduced motion', async () => {
    const css = await buildCss(classes);
    const reduced = block(
      css,
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*?&::after|@media \(prefers-reduced-motion: reduce\)\s*\{/,
    );
    expect(reduced).toMatch(/animation:\s*none/);
  });
});
