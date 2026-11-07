import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // #29 adds '.claude/hooks' when the hooks and their tests exist: Vitest refuses a project folder
    // that doesn't exist yet.
    projects: ['apps/*', 'packages/*', 'config'],
  },
});
