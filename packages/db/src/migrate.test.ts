// Where migrate() takes its migrations from, before it connects (Argus F3, nit on #173): an option left `undefined`
// keeps the default, so a caller passing `{ migrationsFolder: process.env.X }` with X unset still runs this package's
// migrations instead of none.
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
});
