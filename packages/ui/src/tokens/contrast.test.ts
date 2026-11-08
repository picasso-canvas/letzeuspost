import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 AA on the committed tokens, both themes (§05, #70): every text colour on every surface it can sit on
// (DESIGN.md's components list only the pairs the mockup uses, which `design.md lint` checks), and 3:1 for the edges
// that show where a control is (1.4.11): the input border and the focus ring.
const TEXT = [
  'foreground',
  'muted-foreground',
  'faint',
  'accent-text',
  'destructive',
  'status-generating',
  'status-needs-fix',
  'status-in-review',
  'status-with-client',
  'status-approved',
  'status-exported',
  'qc-pass',
  'qc-warn',
  'qc-fail',
];
const SURFACES = ['background', 'card', 'secondary'];
const EDGES = ['input', 'ring'];

function colours(file: string): Map<string, string> {
  const css = readFileSync(new URL(file, import.meta.url), 'utf8');
  return new Map(
    [...css.matchAll(/--color-([\w-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const pairs = (names: string[]) => names.flatMap((n) => SURFACES.map((s) => [n, s] as const));

describe.each([
  ['light', 'theme.css'],
  ['dark', 'dark.css'],
])('contrast in %s (#70)', (_theme, file) => {
  const c = colours(file);
  const hex = (name: string) => {
    const value = c.get(name);
    if (value === undefined) throw new Error(`${file} has no --color-${name}`);
    return value;
  };

  it.each(pairs(TEXT))('%s text on %s passes AA (4.5:1)', (text, surface) => {
    expect(contrast(hex(text), hex(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(pairs(EDGES))('the %s edge on %s reaches 3:1 (1.4.11)', (edge, surface) => {
    expect(contrast(hex(edge), hex(surface))).toBeGreaterThanOrEqual(3);
  });
});
