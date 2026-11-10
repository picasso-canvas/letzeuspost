import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@lzp/ui/components/button';

// WCAG 2.2 AA (4.5:1) for the text of every button variant on its own background, resting and hovered, in light and
// dark (§05, §21). The gallery's axe run (tests/gallery) checks the same in a browser; this one names the pair that
// fails. A tinted background (`bg-x/20`) is laid over each surface a button can sit on.
const VARIANTS = ['default', 'secondary', 'ghost', 'destructive'] as const;
const SURFACES = ['background', 'card', 'secondary'];

type Rgb = [number, number, number];

function tokens(file: string): Map<string, Rgb> {
  const css = readFileSync(new URL(`../tokens/${file}`, import.meta.url), 'utf8');
  return new Map(
    [...css.matchAll(/--color-([\w-]+): #([0-9a-f]{6});/g)].map((m) => {
      const hex = m[2] ?? '';
      return [m[1] ?? '', [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb];
    }),
  );
}

const palette = { light: tokens('theme.css'), dark: tokens('dark.css') };

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `bg-primary/80` laid over a surface. */
function over(top: Rgb, alpha: number, below: Rgb): Rgb {
  return top.map((v, i) => Math.round(v * alpha + (below[i] ?? 0) * (1 - alpha))) as Rgb;
}

/** The class that wins for a property in a theme and state: dark:hover: over hover: over dark: over the plain one. */
function pick(classes: string[], prop: 'bg' | 'text', theme: 'light' | 'dark', hover: boolean) {
  const prefixes = [
    ...(theme === 'dark' && hover ? ['dark:hover:'] : []),
    ...(hover ? ['hover:'] : []),
    ...(theme === 'dark' ? ['dark:'] : []),
    '',
  ];
  for (const prefix of prefixes) {
    for (const cls of classes) {
      if (!cls.startsWith(`${prefix}${prop}-`)) continue;
      const m = new RegExp(`^${prefix.replaceAll(':', '\\:')}${prop}-([a-z-]+?)(?:/(\\d+))?$`).exec(
        cls,
      );
      if (m?.[1] !== undefined && palette[theme].has(m[1]))
        return { name: m[1], alpha: Number(m[2] ?? 100) / 100 };
    }
  }
  return undefined;
}

describe.each(VARIANTS)('the %s button', (variant) => {
  const classes = buttonVariants({ variant }).split(/\s+/);

  describe.each(['light', 'dark'] as const)('in %s', (theme) => {
    const colours = palette[theme];
    const get = (name: string): Rgb => {
      const value = colours.get(name);
      if (value === undefined) throw new Error(`no --color-${name}`);
      return value;
    };

    it.each([false, true])('has text that passes AA on every surface (hovered: %s)', (hover) => {
      // A variant that sets no text colour (ghost) takes the page's: the ink.
      const text = pick(classes, 'text', theme, hover)?.name ?? 'foreground';
      const bg = pick(classes, 'bg', theme, hover);
      for (const surface of SURFACES) {
        const behind = get(surface);
        const fill = bg === undefined ? behind : over(get(bg.name), bg.alpha, behind);
        expect(
          contrast(get(text), fill),
          `${text} on ${bg?.name ?? 'nothing'} over ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
