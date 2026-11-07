import { configDefaults, defineConfig } from 'vitest/config';
import { SERVICE_TESTS } from './vitest.config.ts';

/** The tests that need running services (`pnpm check:services`, and CI's services job). */
export default defineConfig({
  test: {
    include: SERVICE_TESTS.map((glob) => (glob.endsWith('/**') ? `${glob}/*.test.{ts,tsx}` : glob)),
    exclude: configDefaults.exclude,
    passWithNoTests: true, // none yet: #71 and #80 add the first
  },
});
