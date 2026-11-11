import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy.ts';

const CSP = 'content-security-policy';
/** Next.js hands a proxy's request-header changes to the page through these response headers. */
const forwarded = (name: string) => `x-middleware-request-${name}`;

function nonceOf(policy: string | null): string {
  const match = /'nonce-([^']+)'/.exec(policy ?? '');
  if (match?.[1] === undefined) throw new Error('no nonce in the policy');
  return match[1];
}

describe('proxy', () => {
  it('puts a content security policy with a nonce on a page response', () => {
    const response = proxy(new NextRequest('http://localhost:3000/'));
    expect(nonceOf(response.headers.get(CSP))).not.toBe('');
  });

  it('also covers the API and anything else, not only pages', () => {
    for (const path of ['/api/health', '/_next/static/chunk.js', '/no/such/page', '/r/abc']) {
      const response = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.headers.get(CSP), path).toContain("script-src 'self' 'nonce-");
    }
  });

  it('uses a fresh nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 50 }, () =>
        nonceOf(proxy(new NextRequest('http://localhost:3000/')).headers.get(CSP)),
      ),
    );
    expect(nonces.size).toBe(50);
  });

  it('gives the page the same policy and nonce, so Next.js stamps its own scripts', () => {
    const response = proxy(new NextRequest('http://localhost:3000/'));
    const policy = response.headers.get(CSP);
    expect(response.headers.get(forwarded(CSP))).toBe(policy);
    expect(response.headers.get(forwarded('x-nonce'))).toBe(nonceOf(policy));
  });

  it('ignores a nonce or policy the caller sends in its own request headers', () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { [CSP]: "script-src 'unsafe-inline'", 'x-nonce': 'attacker' },
    });
    const response = proxy(request);
    expect(response.headers.get(CSP)).not.toContain('unsafe-inline');
    expect(response.headers.get(forwarded('x-nonce'))).not.toBe('attacker');
    expect(response.headers.get(forwarded(CSP))).toBe(response.headers.get(CSP));
  });

  // Behind Caddy the app sees plain http, so the environment decides, not the request's protocol (§14: staging and
  // production are HTTPS only; only a Mac and CI run without TLS).
  describe('upgrade-insecure-requests', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each(['staging', 'production'])('is asked for in %s, whatever the protocol', (where) => {
      vi.stubEnv('LZP_ENV', where);
      for (const url of ['http://localhost:3000/', 'https://app.letzeuspost.com/']) {
        expect(proxy(new NextRequest(url)).headers.get(CSP), `${where} ${url}`).toContain(
          'upgrade-insecure-requests',
        );
      }
    });

    it.each(['development', 'ci'])('is left out in %s, even over https', (where) => {
      vi.stubEnv('LZP_ENV', where);
      for (const url of ['http://localhost:3000/', 'https://localhost:3000/']) {
        expect(proxy(new NextRequest(url)).headers.get(CSP), `${where} ${url}`).not.toContain(
          'upgrade-insecure-requests',
        );
      }
    });

    it('is left out when LZP_ENV is not set (the app refuses to start without it anyway)', () => {
      vi.stubEnv('LZP_ENV', '');
      expect(proxy(new NextRequest('http://localhost:3000/')).headers.get(CSP)).not.toContain(
        'upgrade-insecure-requests',
      );
    });
  });
});
