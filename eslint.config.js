// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { lzpRuleConfigs } from './scripts/eslint/lzp-rules.mjs';

export default defineConfig(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/.next/', '**/coverage/'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      // No eslint-disable comments: a rule can't be silenced in a file (CLAUDE.md, §20). An attempt is a warning,
      // and `pnpm lint` allows none.
      noInlineConfig: true,
    },
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/email/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-html-link-for-pages': 'off', // App Router: there is no pages/ directory
    },
    settings: { next: { rootDir: 'apps/web/' } },
  },
  // §13 and §21: the raw database client, `use cache`, dangerouslySetInnerHTML, tokens, Lucide and Inter.
  ...lzpRuleConfigs,
);
