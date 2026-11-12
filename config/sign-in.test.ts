import { describe, expect, it } from 'vitest';
import { servedOverHttps } from './env.ts';
import { signInLimits } from './sign-in.ts';

describe('config/sign-in.ts (Q9, Zeus and Athena, 2026-11-07)', () => {
  it('limits sign-in emails to 5 per address and 20 per IP, per hour', () => {
    expect(signInLimits).toEqual({ perAddress: 5, perIp: 20, windowSeconds: 3600 });
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(signInLimits)).toBe(true);
  });
});

describe("config/env.ts's HTTPS rule (§14), which makes cookies Secure", () => {
  it('holds in staging and production, and not on the Mac or in CI', () => {
    expect(servedOverHttps('production')).toBe(true);
    expect(servedOverHttps('staging')).toBe(true);
    expect(servedOverHttps('development')).toBe(false);
    expect(servedOverHttps('ci')).toBe(false);
  });

  it('holds for anything else too: an unknown place is never taken for plain HTTP', () => {
    expect(servedOverHttps('Production')).toBe(true);
    expect(servedOverHttps('')).toBe(true);
  });
});
