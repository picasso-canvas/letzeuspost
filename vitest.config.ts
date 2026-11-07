import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Tests that need running services (Postgres, storage, Mailpit): integration tests end in `.int.test.ts(x)`, and the
 * tenancy suite lives in `tests/tenancy/`. `pnpm check` leaves them out; `pnpm check:services` runs them (§17).
 */
export const SERVICE_TESTS = ['**/*.int.test.{ts,tsx}', 'tests/tenancy/**'];

export default defineConfig({
  test: {
    // #29 adds '.claude/hooks/**/*.test.ts' when the hooks and their tests exist.
    include: [
      '{apps,packages}/*/src/**/*.test.{ts,tsx}',
      'config/**/*.test.ts',
      'scripts/**/*.test.{ts,mjs}',
      'tests/lint/**/*.test.ts',
    ],
    exclude: [...configDefaults.exclude, ...SERVICE_TESTS],
  },
});
