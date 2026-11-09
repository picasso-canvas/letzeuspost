import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig } from 'vite';

// The component gallery (§21): every component in every state, light and dark. CI builds it, uploads it as an
// artifact and runs the screenshot and axe tests against the build (tests/gallery, playwright.config.ts).
// Plain .mjs on purpose: the package's tsconfig doesn't cover .storybook, so the logic lives in src/gallery (typed and
// linted there) and these two files only wire it in.

/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: ['../src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  // The built-in toolbar tools are enough; no add-on, so no extra dependency.
  addons: [],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      // Tailwind 4 reads src/styles/globals.css; the components import each other as `@lzp/ui/...` (components.json).
      plugins: [tailwindcss()],
      resolve: { alias: { '@lzp/ui': fileURLToPath(new URL('../src', import.meta.url)) } },
    }),
};

export default config;
