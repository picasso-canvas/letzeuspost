import { describe, expect, it } from 'vitest';
import { failureOf, linkProblem } from './outcome.ts';

// What the sign-in API answers when a request for a link is refused (packages/auth's hook, Better Auth's own
// validation), and the page's word for each. The page never shows the API's own message: it is English meant for a
// developer ("Try again"), and a person needs to know what they can do next.
describe('failureOf', () => {
  it('knows a bad address: the endpoint’s validation error', () => {
    expect(
      failureOf(400, { code: 'VALIDATION_ERROR', message: '[body.email] Invalid email address' }),
    ).toBe('invalidEmail');
  });

  it('knows too many requests, with or without a body', () => {
    expect(failureOf(429, { code: 'TOO_MANY_REQUESTS', message: 'Try again in an hour.' })).toBe(
      'tooManyRequests',
    );
    // A limit set in front of the app (Cloudflare, Caddy) answers 429 with a page, not our JSON.
    expect(failureOf(429, null)).toBe('tooManyRequests');
  });

  it('knows a request that did not come through Cloudflare, apart from "try again"', () => {
    expect(
      failureOf(400, { code: 'CLIENT_IP_UNKNOWN', message: 'This request could not be checked.' }),
    ).toBe('unknownClient');
  });

  it.each([
    ['a refused origin', 403, { code: 'INVALID_ORIGIN', message: 'Invalid origin' }],
    ['a server error with no body', 500, null],
    ['a server error with a body that is not an object', 500, 'Internal Server Error'],
    ['a 400 with a code we do not know', 400, { code: 'SOMETHING_NEW' }],
    ['a 400 with no code', 400, {}],
    ['a 502 from the proxy', 502, undefined],
  ])('falls back to the plain "something went wrong" for %s', (_name, status, body) => {
    expect(failureOf(status, body)).toBe('generic');
  });

  it('goes by the code and the status, never by the words of the message', () => {
    expect(failureOf(400, { message: 'Too many requests. Invalid email address.' })).toBe(
      'generic',
    );
    expect(failureOf(500, { code: 'VALIDATION_ERROR' })).toBe('generic');
    expect(failureOf(400, { code: 'TOO_MANY_REQUESTS' })).toBe('generic');
  });
});

// The magic link's own check sends a refused link back to /sign-in?error=… (Better Auth: INVALID_TOKEN for a link that
// is unknown, used or expired; other codes for rarer breaks). The page doesn't tell them apart: each means "ask for a
// new link".
describe('linkProblem', () => {
  it('is there when the page was opened with an error', () => {
    expect(linkProblem('INVALID_TOKEN')).toBe(true);
    expect(linkProblem('new_user_signup_disabled')).toBe(true);
    expect(linkProblem(['INVALID_TOKEN', 'x'])).toBe(true);
  });

  it('is not there on a plain visit', () => {
    expect(linkProblem(undefined)).toBe(false);
    expect(linkProblem('')).toBe(false);
    expect(linkProblem([])).toBe(false);
  });
});
