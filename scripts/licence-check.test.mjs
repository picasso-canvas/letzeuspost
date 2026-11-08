import { describe, expect, it } from 'vitest';

import {
  checkLicences,
  isAllowedExpression,
  licenceListArgs,
  parseSpdx,
} from './licence-check.mjs';

/**
 * @param {string} name
 * @param {string} license
 * @param {string} [version]
 */
const pkg = (name, license, version = '1.0.0') => ({ name, versions: [version], license });

/**
 * Builds the shape `pnpm licenses list --json` prints: packages grouped by licence.
 * @param {Array<{ name: string, versions: string[], license: string }>} pkgs
 */
const list = (pkgs) => {
  /** @type {Record<string, typeof pkgs>} */
  const out = {};
  for (const p of pkgs) (out[p.license] ??= []).push(p);
  return out;
};

describe('parseSpdx', () => {
  it('parses a single id', () => {
    expect(parseSpdx('MIT')).toEqual({ type: 'id', id: 'MIT' });
  });

  it('gives AND higher precedence than OR', () => {
    expect(parseSpdx('MIT OR Apache-2.0 AND GPL-3.0')).toEqual({
      type: 'or',
      args: [
        { type: 'id', id: 'MIT' },
        {
          type: 'and',
          args: [
            { type: 'id', id: 'Apache-2.0' },
            { type: 'id', id: 'GPL-3.0' },
          ],
        },
      ],
    });
  });

  it('accepts lowercase operators and parentheses', () => {
    expect(parseSpdx('(MIT or Apache-2.0)')).toEqual({
      type: 'or',
      args: [
        { type: 'id', id: 'MIT' },
        { type: 'id', id: 'Apache-2.0' },
      ],
    });
  });

  it('accepts only known SPDX exception ids after WITH', () => {
    expect(parseSpdx('Apache-2.0 WITH LLVM-exception')).toEqual({ type: 'id', id: 'Apache-2.0' });
    expect(parseSpdx('GPL-2.0 WITH Classpath-exception-2.0')).toEqual({
      type: 'id',
      id: 'GPL-2.0',
    });
    expect(parseSpdx('MIT WITH Made-Up-exception')).toBeNull();
    expect(parseSpdx('MIT WITH')).toBeNull();
  });

  it('rejects a value that is not text', () => {
    expect(parseSpdx(/** @type {any} */ (42))).toBeNull();
    expect(parseSpdx(/** @type {any} */ ({ type: 'MIT' }))).toBeNull();
  });

  it('rejects text that is not an SPDX expression', () => {
    expect(parseSpdx('SEE LICENSE IN LICENSE.md')).toBeNull();
    expect(parseSpdx('(MIT')).toBeNull();
    expect(parseSpdx('')).toBeNull();
  });
});

describe('isAllowedExpression', () => {
  it.each([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    '0BSD',
    'ISC',
    'PostgreSQL',
    'OFL-1.1',
    'BlueOak-1.0.0',
    '(MIT OR GPL-3.0)',
    '(MIT AND ISC)',
    'Apache-2.0 WITH LLVM-exception',
  ])('allows %s', (expr) => {
    expect(isAllowedExpression(expr)).toBe(true);
  });

  it.each([
    'GPL-3.0',
    'GPL-2.0-or-later',
    'LGPL-3.0-or-later',
    'AGPL-3.0',
    'MPL-2.0',
    '(MIT AND GPL-3.0)',
    'GPL-2.0 WITH Classpath-exception-2.0',
    'MIT WITH Made-Up-exception',
    'UNLICENSED',
    'Unknown',
    'SEE LICENSE IN LICENSE',
    '',
  ])('refuses %s', (expr) => {
    expect(isAllowedExpression(expr)).toBe(false);
  });
});

describe('licenceListArgs', () => {
  it('lists every workspace package, not only the root', () => {
    expect(licenceListArgs({ prod: false })).toEqual(['-r', 'licenses', 'list', '--json']);
    expect(licenceListArgs({ prod: true })).toEqual(['-r', 'licenses', 'list', '--json', '--prod']);
  });
});

describe('checkLicences', () => {
  it('reports a licence field that is not text, with a clear reason', () => {
    const all = {
      MIT: [
        { name: 'weird', versions: ['1.0.0'], license: { type: 'MIT' } },
        { name: 'weirder', versions: ['1.0.0'], license: undefined },
      ],
    };
    expect(checkLicences(all, {})).toEqual([
      {
        name: 'weird',
        versions: ['1.0.0'],
        license: '{"type":"MIT"}',
        reason: 'licence field is not text',
      },
      {
        name: 'weirder',
        versions: ['1.0.0'],
        license: 'undefined',
        reason: 'licence field is not text',
      },
    ]);
  });

  it('passes a tree of allowed licences', () => {
    const all = list([pkg('a', 'MIT'), pkg('b', 'Apache-2.0'), pkg('c', '(MIT OR GPL-3.0)')]);
    expect(checkLicences(all, list([pkg('a', 'MIT')]))).toEqual([]);
  });

  it('fails a GPL dependency and names it', () => {
    const all = list([
      pkg('a', 'MIT'),
      pkg('@wordpress/is-shallow-equal', 'GPL-2.0-or-later', '5.0.0'),
    ]);
    expect(checkLicences(all, {})).toEqual([
      {
        name: '@wordpress/is-shallow-equal',
        versions: ['5.0.0'],
        license: 'GPL-2.0-or-later',
        reason: 'licence not on the allowlist',
      },
    ]);
  });

  it('fails a package with no licence', () => {
    const all = list([pkg('nolicence', 'Unknown')]);
    expect(checkLicences(all, {})).toHaveLength(1);
  });

  it('allows libvips by exact package name and licence', () => {
    const all = list([pkg('@img/sharp-libvips-linux-x64', 'LGPL-3.0-or-later')]);
    expect(checkLicences(all, all)).toEqual([]);
  });

  it('does not stretch the libvips exception to other names or licences', () => {
    const all = list([
      pkg('@img/sharp-libvips-fake', 'LGPL-3.0-or-later'),
      pkg('@img/sharp-libvips-linux-x64', 'GPL-3.0'),
      pkg('sharp-libvips-linux-x64', 'LGPL-3.0-or-later'),
    ]);
    expect(checkLicences(all, {}).map((v) => v.name)).toEqual([
      '@img/sharp-libvips-fake',
      '@img/sharp-libvips-linux-x64',
      'sharp-libvips-linux-x64',
    ]);
  });

  it('allows BlueOak-1.0.0 in production dependencies too', () => {
    const all = list([pkg('minimatch', 'BlueOak-1.0.0')]);
    expect(checkLicences(all, all)).toEqual([]);
  });

  it('allows the MPL-2.0 dev-tool exception in the dev tree', () => {
    const all = list([
      pkg('lightningcss', 'MPL-2.0'),
      pkg('lightningcss-linux-x64-gnu', 'MPL-2.0'),
    ]);
    expect(checkLicences(all, {})).toEqual([]);
  });

  it('fails any other MPL-2.0 package, dev or not', () => {
    const all = list([pkg('some-mpl-tool', 'MPL-2.0'), pkg('lightningcss-fake', 'MPL-2.0')]);
    expect(checkLicences(all, {}).map((v) => v.name)).toEqual([
      'lightningcss-fake',
      'some-mpl-tool',
    ]);
  });

  it('allows @google/design.md, whose npm metadata has no licence, as a dev tool only (Q2, #70)', () => {
    const all = list([pkg('@google/design.md', 'Unknown', '0.4.0')]);
    expect(checkLicences(all, {})).toEqual([]);
    expect(checkLicences(all, all).map((v) => v.reason)).toEqual([
      'exception is for dev tooling only, but this is a production dependency',
    ]);
    const others = list([pkg('@google/other', 'Unknown'), pkg('design.md', 'Unknown')]);
    expect(checkLicences(others, {}).map((v) => v.name)).toEqual(['@google/other', 'design.md']);
  });

  it('fails a dev-only exception that reaches production dependencies', () => {
    const all = list([pkg('lightningcss', 'MPL-2.0')]);
    expect(checkLicences(all, all)).toEqual([
      {
        name: 'lightningcss',
        versions: ['1.0.0'],
        license: 'MPL-2.0',
        reason: 'exception is for dev tooling only, but this is a production dependency',
      },
    ]);
  });
});
