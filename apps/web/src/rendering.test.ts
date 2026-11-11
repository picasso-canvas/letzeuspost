// §13: workspace data never goes into Next.js's shared caches, and pages render per request. Lint bans `use cache` and
// `cacheComponents` (lzp/no-use-cache); this checks the two places the setting would show.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('rendering per request', () => {
  it('leaves cache components out of next.config', () => {
    const config = read('../next.config.ts');
    expect(config).toContain("output: 'standalone'");
    // As a setting (`name:`); the comment that says they stay off may name them.
    expect(config).not.toMatch(/\b(?:cacheComponents|ppr|dynamicIO|useCache)\s*:/);
  });

  it('renders every page per request, from the root layout', () => {
    const layout = read('./app/layout.tsx');
    expect(layout).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(layout).not.toMatch(/use cache|revalidate|force-static/);
  });

  it('renders the health route per request, so the database is asked every time', () => {
    const route = read('./app/api/health/route.ts');
    expect(route).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(route).not.toMatch(/use cache|revalidate|force-static/);
  });
});
