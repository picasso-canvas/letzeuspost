// hitRateLimit's windows, checked without services (#323): the scheduled prune (./jobs/auth-prune.ts) deletes every
// hit older than the longest window any bucket uses, so a bucket may never count in a longer one. Nothing here
// connects: pg's pool opens a connection only for a query, and the refusal comes before one.
import { signInLimits } from '@lzp/config';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthDb, RATE_LIMIT_LONGEST_WINDOW_SECONDS, type AuthDb } from './auth.ts';

const URL = 'postgres://lzp_app:unused@127.0.0.1:1/letzeuspost';
let authDb: AuthDb | undefined;

afterEach(async () => {
  await authDb?.close();
  authDb = undefined;
});

describe('hitRateLimit and the longest window (#323)', () => {
  it("takes the longest window from sign-in's limits, the only buckets so far", () => {
    expect(RATE_LIMIT_LONGEST_WINDOW_SECONDS).toBe(signInLimits.windowSeconds);
  });

  it('refuses a window longer than the longest, before any query: the prune would delete hits inside it', async () => {
    authDb = createAuthDb(URL);
    await expect(
      authDb.hitRateLimit('test:longer', 5, RATE_LIMIT_LONGEST_WINDOW_SECONDS + 1),
    ).rejects.toThrow(/longer than the longest/);
  });
});
