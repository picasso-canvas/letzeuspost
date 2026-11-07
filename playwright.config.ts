import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Screen and end-to-end tests (§17), run by `pnpm check:services` and CI's services job: the component gallery (the
// built Storybook) and the app at 1440 px, light and dark. New screenshots land in tests/visual/output (CI uploads
// them); approved baselines live in tests/visual/approved, which only Athena writes, after Iris and Zeus approve the
// first ones (Q11).
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const ci = process.env.CI !== undefined;
// A server starts only when its tests exist, so `pnpm check:services` passes before the first screen tests land.
const gallery = existsSync('tests/gallery');
const app = existsSync('tests/e2e');

export default defineConfig({
  outputDir: 'tests/visual/output',
  snapshotPathTemplate: 'tests/visual/approved/{projectName}/{testFilePath}/{arg}{ext}',
  forbidOnly: true,
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
