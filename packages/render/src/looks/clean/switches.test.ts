import { LookSchema } from '@lzp/core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { switchClasses, type Switches } from '../../page/switches.ts';
import { CLEAN_CSS } from './css.ts';

// §07's switches, as the post schema allows them, and the Clean look's rule for each (§08: the switches become classes
// on the page). The list comes from the schema, so a value added there fails here until the look styles it.

const BASE: Switches = {
  corners: 'soft',
  frame: 'none',
  highlight: 'default',
  decorations: true,
  logo: 'bottom-left',
};

/** The switches in the order `switchClasses` writes their classes. */
const ORDER = ['corners', 'frame', 'highlight', 'decorations', 'logo'] as const;
const SCHEMA_SWITCHES = LookSchema.shape.switches.unwrap().shape;

/** Every value the schema allows for each switch, as the class the page gets for it. */
const schemaClasses = (): string[] =>
  ORDER.flatMap((name, at) => {
    const inner = SCHEMA_SWITCHES[name].unwrap();
    const values: readonly unknown[] = inner instanceof z.ZodEnum ? inner.options : [true, false];
    return values.map((value) => switchClasses({ ...BASE, [name]: value })[at] ?? '');
  });

/** The selectors of every rule in the CSS (at-rules' own blocks included). */
const selectors = (css: string): string[] =>
  [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(([, list]) =>
    (list ?? '').split(',').map((selector) => selector.trim()),
  );

describe('the Clean look styles every switch', () => {
  const classes = schemaClasses();

  it('reads all sixteen switch classes from the schema', () => {
    expect(Object.keys(SCHEMA_SWITCHES).sort()).toEqual([...ORDER].sort());
    expect([...classes].sort()).toEqual(
      [
        'corners-sharp',
        'corners-soft',
        'corners-round',
        'frame-none',
        'frame-print',
        'frame-rounded',
        'frame-full-bleed',
        'hl-default',
        'hl-pill',
        'hl-underline',
        'hl-color',
        'decor-on',
        'decor-off',
        'logo-bottom-left',
        'logo-bottom-right',
        'logo-top',
      ].sort(),
    );
  });

  it.each(classes)('has a rule for .%s', (cls) => {
    const pattern = new RegExp(`\\.${cls}(?![\\w-])`);
    expect(selectors(CLEAN_CSS).some((selector) => pattern.test(selector))).toBe(true);
  });

  it('would fail on a class with no rule', () => {
    const pattern = /\.hl-sparkle(?![\w-])/;
    expect(selectors(CLEAN_CSS).some((selector) => pattern.test(selector))).toBe(false);
  });
});
