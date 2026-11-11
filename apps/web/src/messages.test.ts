import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from './app/page.tsx';
import { messages } from './messages.ts';

/** Every string in a messages object, whatever its depth. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leaves);
  return [];
}

describe('interface text', () => {
  it('has no empty message', () => {
    expect(leaves(messages).length).toBeGreaterThan(0);
    for (const text of leaves(messages)) expect(text.trim()).not.toBe('');
  });

  it('is what the placeholder page shows, and all of it', () => {
    const html = renderToStaticMarkup(Home());
    const shown = html
      .split(/<[^>]*>/)
      .map((text) => text.trim())
      .filter((text) => text !== '');
    const known = new Set(leaves(messages));
    expect(shown.length).toBeGreaterThan(0);
    for (const text of shown) expect(known, `"${text}" is not in messages/en.json`).toContain(text);
    expect(shown).toContain(messages.home.heading);
  });

  it('is the only place a component writes words: no sentence sits in the JSX', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
      });
    const here = path.dirname(new URL(import.meta.url).pathname);
    for (const file of files(here)) {
      const source = readFileSync(file, 'utf8');
      // Text between a closing `>` and an opening `<` that holds a letter (JSX text, not `{expressions}`).
      const text = [...source.matchAll(/>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g)]
        .map((match) => match[1]?.trim() ?? '')
        .filter((words) => !/^(=>|[=&|?:;,()]+)/.test(words) && !words.includes('=>'));
      expect(
        text,
        `${path.relative(here, file)} writes words in JSX: use messages/en.json`,
      ).toEqual([]);
    }
  });
});
