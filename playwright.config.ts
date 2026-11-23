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
// The projects this run asks for, read the way Playwright reads them: `--project=x`, or `--project x y` (every name up
// to the next flag), each a case-insensitive pattern where `*` matches anything; none means every one. CI's design
// job runs only the gallery, so the app's servers mustn't start there (#172).
const asked = process.argv
  .flatMap((arg, i, all) => {
    if (arg.startsWith('--project=')) return [arg.slice('--project='.length)];
    if (arg !== '--project') return [];
    const end = all.findIndex((next, j) => j > i && next.startsWith('-'));
    return all.slice(i + 1, end === -1 ? undefined : end);
  })
  .map(
    (name) =>
      new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`, 'i'),
  );
const runs = (name: string) => asked.length === 0 || asked.some((pattern) => pattern.test(name));
// A server starts only when its tests exist and this run includes them, so `pnpm check:services` passes before the
// first screen tests land.
const gallery = existsSync('tests/gallery') && runs('gallery');
const app =
  (existsSync('tests/e2e') && (runs('app-light') || runs('app-dark'))) ||
  (journeySpecs && runs('journeys'));

export default defineConfig({
  outputDir: 'tests/visual/output',
  snapshotPathTemplate: 'tests/visual/approved/{projectName}/{testFilePath}/{arg}{ext}',
  forbidOnly: true,
  // Never write baselines into tests/visual/approved: only Athena moves approved ones there (Q11).
  updateSnapshots: 'none',
  // Any changed pixel fails (§21, #129): Playwright's default per-pixel colour threshold of 0.2 would let a small
  // colour regression through. CI renders on one image, so the same page gives the same pixels.
  // scripts/playwright-config.test.ts holds both at 0.
  expect: { toHaveScreenshot: { threshold: 0, maxDiffPixels: 0 } },
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
      // `<feature>.int.spec.ts` is Vitest's (vitest.config.ts runs `*.int.{test,spec}.*`), never Playwright's.
      testIgnore: '**/*.int.*',
      use: { ...desktop, colorScheme: 'light', baseURL: 'http://localhost:3000' },
    },
    {
      // The render engine's browser tests (§08, #327): they open their own Chromium through packages/render and need
      // no server, so no web server starts for them.
      name: 'render',
      testDir: 'tests/render',
      testMatch: '**/*.spec.ts',
      // Its own folder: a run empties the output folder of the projects it runs, and the end-to-end screens for Iris
      // and Zeus are collected from tests/visual/output (Q11).
      outputDir: 'tests/render-output',
    },
    {
      // The golden renders (§08, §17): baselines live beside the specs; only Athena commits them, after Zeus's look.
      name: 'golden',
      testDir: 'tests/golden',
      testMatch: '**/*.spec.ts',
      snapshotPathTemplate: 'tests/golden/baselines/{testFilePath}/{arg}{ext}',
      outputDir: 'tests/golden-output',
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
            // The worker has no port: it counts as started once it logs `worker.ready`, after its jobs are registered.
            command: 'pnpm --filter @lzp/worker start',
            wait: { stdout: /"event":"worker\.ready"/ },
            reuseExistingServer: false,
          },
        ]
      : []),
  ],
});
