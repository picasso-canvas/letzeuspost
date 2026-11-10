import { describe, expect, it } from 'vitest';
import { EmailTemplateError, renderTemplate } from './index.ts';

const appUrl = 'http://localhost:3000';

describe('renderTemplate (the base layout, §23: short, plain, one button, a plain-text version)', () => {
  it('renders a subject, a complete HTML document and a plain-text version', async () => {
    const email = await renderTemplate('email-check', { name: 'Picasso Studio' }, { appUrl });
    expect(email.subject).not.toBe('');
    expect(email.html.toLowerCase()).toContain('<!doctype html');
    expect(email.html).toContain('Picasso Studio');
    expect(email.text).toContain('Picasso Studio');
    expect(email.text).not.toMatch(/<[a-z][^>]*>/i); // no markup in the plain-text version
  });

  it('has exactly one button, and the plain-text version still carries its link', async () => {
    const email = await renderTemplate('email-check', { name: 'Picasso Studio' }, { appUrl });
    const links = [...email.html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(links).toEqual([appUrl]);
    expect(email.text).toContain(appUrl);
  });

  it('keeps Bangla text whole in both versions', async () => {
    const name = 'গল্প ক্যাফে';
    const email = await renderTemplate('email-check', { name }, { appUrl });
    expect(email.html).toContain(name);
    expect(email.text).toContain(name);
  });

  it('escapes what the data holds instead of rendering it as markup', async () => {
    const email = await renderTemplate('email-check', { name: '<b>bold</b>' }, { appUrl });
    expect(email.html).not.toContain('<b>bold</b>');
    expect(email.html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('refuses a template it does not know', async () => {
    await expect(renderTemplate('no-such-template', {}, { appUrl })).rejects.toThrow(
      EmailTemplateError,
    );
  });

  it.each([
    ['no name', {}],
    ['an empty name', { name: '' }],
    ['a name that is not text', { name: 42 }],
    ['a name over 200 characters', { name: 'a'.repeat(201) }],
    ['data that is not an object', 'Picasso Studio'],
  ])('refuses data with %s, without repeating the data in the error', async (_, data) => {
    const refused = renderTemplate('email-check', data, { appUrl });
    await expect(refused).rejects.toThrow(EmailTemplateError);
    await expect(refused).rejects.not.toThrow(/Picasso|aaaa|42/);
  });
});
