import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';

/** Integration tests (they need Postgres, storage or Mailpit) end in `.int.test.ts(x)`. */
const INTEGRATION = '**/*.int.{test,spec}.{ts,tsx,mts,cts,js,mjs}';

// One project per package, named like the package, so `pnpm vitest run --project @lzp/web` works. Tests that need
// running services are left out; `pnpm check:services` sets LZP_SERVICES=1 and runs only those: the integration tests
// and the tenancy suite (§17). This file is builder-protected, so a builder can't move a test out of either run.
const dirs = [
  ...['apps', 'packages'].flatMap((top) =>
    readdirSync(top, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${top}/${entry.name}`),
  ),
  'config',
  'scripts',
  'tests/lint',
  '.claude/hooks',
];
const nameOf = (dir: string): string =>
  existsSync(`${dir}/package.json`)
    ? (JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as { name: string }).name
    : dir;

export default defineConfig({
  test: {
    // The services run has no tests yet: #71 and #80 add the first.
    passWithNoTests: process.env.LZP_SERVICES === '1',
    projects:
      process.env.LZP_SERVICES === '1'
        ? [
            {
              test: {
                name: 'services',
                include: [INTEGRATION, 'tests/tenancy/**/*.{test,spec}.{ts,tsx,mts,cts,js,mjs}'],
                exclude: configDefaults.exclude,
              },
            },
          ]
        : dirs.map((dir) => ({
            test: {
              name: nameOf(dir),
              root: dir,
              include: ['**/*.{test,spec}.{ts,tsx,mts,cts,js,mjs}'],
              exclude: [...configDefaults.exclude, INTEGRATION],
            },
          })),
  },
});
