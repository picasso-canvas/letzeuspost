// The sign-in link email (#77): a React Email template with a plain-text version, whose one button is the link. The
// link must lead into the app (APP_URL): a row whose link points anywhere else is refused, never sent.
import { describe, expect, it } from 'vitest';
import { EmailTemplateError, renderTemplate } from '../index.ts';

const appUrl = 'http://localhost:3000';
const url = `${appUrl}/api/auth/magic-link/verify?token=AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf&callbackURL=%2Fapp`;

describe('the sign-in-link email', () => {
  it('renders an HTML version and a plain-text version, both carrying the link', async () => {
    const email = await renderTemplate('sign-in-link', { url }, { appUrl });
    expect(email.subject).toBe('Your LetZeusPost sign-in link');
    expect(email.html.toLowerCase()).toContain('<!doctype html');
    expect(email.text).not.toMatch(/<[a-z][^>]*>/i);
    expect(email.text).toContain(url);
  });

  it('has exactly one button, and it is the link', async () => {
    const email = await renderTemplate('sign-in-link', { url }, { appUrl });
    const links = [...email.html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((match) =>
      (match[1] ?? '').replaceAll('&amp;', '&'),
    );
    expect(links).toEqual([url]);
  });

  it('says the link works once and for 10 minutes (A5), in both versions', async () => {
    const email = await renderTemplate('sign-in-link', { url }, { appUrl });
    for (const version of [email.html, email.text]) {
      expect(version).toContain('10 minutes');
      expect(version).toContain('once');
    }
  });

  it.each([
    ['no link', {}],
    ['a link that is not text', { url: 42 }],
    ['a link outside the app', { url: 'https://evil.example/api/auth/magic-link/verify?token=x' }],
    [
      'a link on a host that only starts like the app',
      { url: 'http://localhost:3000.evil.example/x' },
    ],
    ['a javascript: link', { url: 'javascript:alert(1)' }],
    ['the app itself, with no path to verify', { url: appUrl }],
    ['a link over 2000 characters', { url: `${appUrl}/api/auth/${'a'.repeat(2000)}` }],
  ])('refuses data with %s, without repeating it in the error', async (_, data) => {
    const refused = renderTemplate('sign-in-link', data, { appUrl });
    await expect(refused).rejects.toThrow(EmailTemplateError);
    await expect(refused).rejects.not.toThrow(/evil|token|aaaa|42/);
  });
});
