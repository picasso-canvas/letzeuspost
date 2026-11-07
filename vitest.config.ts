import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'config', 'scripts', '.claude/hooks'],
  },
});
