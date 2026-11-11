import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from './csp.ts';

/** A policy's directives by name, each as its list of sources. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name !== undefined && name !== '')
      .map(([name, ...sources]) => [name ?? '', sources]),
  );
}

describe('newNonce', () => {
  it('is at least 128 bits of base64', () => {
    const nonce = newNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(nonce, 'base64').length).toBeGreaterThanOrEqual(16);
  });

  it('is fresh on every call', () => {
    const nonces = new Set(Array.from({ length: 1000 }, () => newNonce()));
    expect(nonces.size).toBe(1000);
  });
});

describe('contentSecurityPolicy', () => {
  const nonce = 'dGVzdC1ub25jZS0xMjM0NQ==';
  const policy = contentSecurityPolicy(nonce, { development: false });
  const found = directives(policy);

  it('lets scripts run only with the nonce', () => {
    const scripts = found.get('script-src');
    expect(scripts).toContain(`'nonce-${nonce}'`);
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it('keeps inline styles out as well', () => {
    expect(found.get('style-src')).not.toContain("'unsafe-inline'");
  });

  it('allows only our own origin, with no third-party source anywhere', () => {
    expect(found.get('default-src')).toEqual(["'self'"]);
    expect(policy).not.toMatch(/https?:|\*/);
  });

  it('shuts plugins, framing, base-uri changes and foreign form posts', () => {
    expect(found.get('object-src')).toEqual(["'none'"]);
    expect(found.get('frame-ancestors')).toEqual(["'none'"]);
    expect(found.get('base-uri')).toEqual(["'self'"]);
    expect(found.get('form-action')).toEqual(["'self'"]);
  });

  it('upgrades insecure requests in production, never on a plain-HTTP Mac', () => {
    expect(contentSecurityPolicy(nonce, { development: false, https: true })).toContain(
      'upgrade-insecure-requests',
    );
    expect(contentSecurityPolicy(nonce, { development: false, https: false })).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('adds eval for the development server only', () => {
    const dev = directives(contentSecurityPolicy(nonce, { development: true }));
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
    expect(dev.get('script-src')).toContain(`'nonce-${nonce}'`);
    expect(dev.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('refuses a nonce that could break out of the header', () => {
    expect(() => contentSecurityPolicy("x'; script-src *", { development: false })).toThrow();
    expect(() => contentSecurityPolicy('', { development: false })).toThrow();
  });
});
