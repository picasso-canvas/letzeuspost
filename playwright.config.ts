import { existsSync, readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Screen and end-to-end tests (§17), run by `pnpm check:services` and CI's services job: the component gallery (the
// built Storybook), the app at 1440 px, light and dark, and the features' journeys that drive the app (§19). New
// screenshots land in tests/visual/output (CI uploads them); approved baselines live in tests/visual/approved, which
// only Athena writes, after Iris and Zeus approve the first ones (Q11).
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const ci = process.env.CI !== undefined;
// A feature's journey (§19) is a Playwright spec, `tests/journeys/<feature>.spec.ts` or under `<feature>/`; a
// feature with no screen has a Vitest one (`<feature>.int.test.ts`), which this config never runs (#172).
const journeySpecs =
  existsSync('tests/journeys') &&
  readdirSync('tests/journeys', { recursive: true }).some((f) => String(f).endsWith('.spec.ts'));
// A server starts only when its tests exist, so `pnpm check:services` passes before the first screen tests land.
const gallery = existsSync('tests/gallery');
const app = existsSync('tests/e2e') || journeySpecs;

export default defineConfig({
  outputDir: 'tests/visual/output',
  snapshotPathTemplate: 'tests/visual/approved/{projectName}/{testFilePath}/{arg}{ext}',
  forbidOnly: true,
  // Never write baselines into tests/visual/approved: only Athena moves approved ones there (Q11).
  updateSnapshots: 'none',
  reporter: ci ? 'github' : 'list',
  projects: [
    {
      name: 'gallery',
      testDir: 'tests/gallery',
      use: { ...desktop, baseURL: 'http://localhost:6006' },
    },
    {
      name: 'app-light',
      testDir: 'tests/e2e',
      use: { ...desktop, colorScheme: 'light', baseURL: 'http://localhost:3000' },
    },
    {
      name: 'app-dark',
      testDir: 'tests/e2e',
      use: { ...desktop, colorScheme: 'dark', baseURL: 'http://localhost:3000' },
    },
    {
      // Journeys check what a person can do, not how it looks: one theme is enough (#172).
      name: 'journeys',
      testDir: 'tests/journeys',
      testMatch: '**/*.spec.ts',
      use: { ...desktop, colorScheme: 'light', baseURL: 'http://localhost:3000' },
    },
  ],
  webServer: [
    ...(gallery
      ? [
          {
            // The built gallery (`pnpm --filter @lzp/ui build-storybook` first), served as static files.
            command:
              'pnpm --filter @lzp/ui exec vite preview --outDir storybook-static --port 6006 --strictPort',
            url: 'http://localhost:6006',
            reuseExistingServer: !ci,
          },
        ]
      : []),
    ...(app
      ? [
          {
            // The built app (`pnpm --filter @lzp/web build` first).
            command: 'pnpm --filter @lzp/web start --port 3000',
            url: 'http://localhost:3000',
            reuseExistingServer: !ci,
          },
          {
            // The worker has no port: it counts as started once it prints its ready line (#72 adds it).
            command: 'pnpm --filter @lzp/worker start',
            wait: { stdout: /worker ready/ },
            reuseExistingServer: false,
          },
        ]
      : []),
  ],
});
