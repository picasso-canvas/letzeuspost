// The sign-in route (#77, §13 The app's API): Better Auth's handler from packages/auth, mounted at /api/auth/*, for GET
// and POST alone, rendered per request. Which of Better Auth's endpoints it serves is packages/auth's
// SERVED_ENDPOINTS, tested there; this checks the mount.
import { readFileSync } from 'node:fs';
import { AUTH_BASE_PATH } from '@lzp/auth';
import { describe, expect, it } from 'vitest';
import * as route from './route.ts';

describe('/api/auth/[...all]', () => {
  it('answers GET and POST with the handler, and no other method', () => {
    expect(typeof route.GET).toBe('function');
    expect(route.POST).toBe(route.GET);
    expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic']);
  });

  it('is rendered per request: a session is never cached', () => {
    expect(route.dynamic).toBe('force-dynamic');
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/use cache|revalidate|force-static/);
  });

  it('sits where packages/auth makes its links point', () => {
    expect(decodeURIComponent(new URL('./route.ts', import.meta.url).pathname)).toContain(
      `/app${AUTH_BASE_PATH}/[...all]/route.ts`,
    );
  });
});
