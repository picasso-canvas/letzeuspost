// Where migrate() takes its migrations from, before it connects (Argus F3, nit on #173): an option left `undefined`
// keeps the default, so a caller passing `{ migrationsFolder: process.env.X }` with X unset still runs this package's
// migrations instead of none.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migratorConfig } from './migrate.ts';

const PACKAGE_MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

describe('migratorConfig(options)', () => {
  it("uses this package's migrations by default", () => {
    expect(migratorConfig()).toEqual({ migrationsFolder: PACKAGE_MIGRATIONS });
    expect(migratorConfig({})).toEqual({ migrationsFolder: PACKAGE_MIGRATIONS });
  });

  it('keeps the default folder and schema when they are passed as undefined', () => {
    expect(migratorConfig({ migrationsFolder: undefined, migrationsSchema: undefined })).toEqual({
      migrationsFolder: PACKAGE_MIGRATIONS,
    });
  });

  it('takes a folder and a schema that are given', () => {
    expect(migratorConfig({ migrationsFolder: '/tmp/probe', migrationsSchema: 'probe' })).toEqual({
      migrationsFolder: '/tmp/probe',
      migrationsSchema: 'probe',
    });
  });

  // The web app imports @lzp/db, and a bundler (Turbopack) reads `new URL('<path>', import.meta.url)` as an asset to
  // bundle: '../migrations' is a folder, so `next build` failed on it (#172). The path is joined at run time instead.
  it('names its folder in a way no bundler tries to resolve', () => {
    const source = readFileSync(new URL('migrate.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/new URL\(\s*['"`][^'"`]*['"`]\s*,\s*import\.meta\.url\s*\)/);
  });
});
