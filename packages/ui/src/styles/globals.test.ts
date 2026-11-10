import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

// The one stylesheet packages/ui exposes (#74): Tailwind, the generated tokens (#70), light and dark, self-hosted Inter.
const stylesDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const uiDir = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(new URL('globals.css', import.meta.url), 'utf8');

/** Where a bare `@import 'name'` lives: the package's own dependencies, as a bundler finds them. */
const packages: Record<string, string> = {
  tailwindcss: `${uiDir}node_modules/tailwindcss/index.css`,
  'tw-animate-css': `${uiDir}node_modules/tw-animate-css/dist/tw-animate.css`,
};

/** Compiles globals.css the way the Vite plugin does and returns the CSS for the given utility classes. */
async function build(candidates: string[]): Promise<string> {
  const compiler = await compile(source, {
    base: stylesDir,
    loadStylesheet: (id, base) => {
      const path = packages[id] ?? new URL(id, `file://${base}/`).pathname;
      return Promise.resolve({
        path,
        base: path.slice(0, path.lastIndexOf('/')),
        content: readFileSync(path, 'utf8'),
      });
    },
  });
  return compiler.build(candidates);
}

describe('globals.css', () => {
  it('imports Tailwind and the three generated token files', () => {
    expect(source).toMatch(/@import\s+['"]tailwindcss['"]/);
    for (const file of ['theme', 'base', 'dark'])
      expect(source, file).toMatch(new RegExp(`@import\\s+['"]\\.\\./tokens/${file}\\.css['"]`));
  });

  it('turns the generated tokens into utilities, light values on :root', async () => {
    const css = await build(['bg-primary', 'text-primary-foreground', 'outline-ring']);
    expect(css).toMatch(/\.bg-primary\s*\{[^}]*var\(--color-primary\)/);
    expect(css).toMatch(/:root[^{]*\{[^}]*--color-primary:\s*#f5b301/i);
    expect(css).toMatch(/:root[^{]*\{[^}]*--color-ring:\s*#1c1a17/i);
  });

  it('switches to the dark values under the .dark class, and dark: utilities follow it', async () => {
    const css = await build(['dark:bg-primary', 'outline-ring']);
    expect(css).toMatch(/\.dark\s*\{[^}]*--color-ring:\s*#f5b301/i);
    expect(css).toMatch(/\.dark\\:bg-primary[^{]*\.dark/);
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('sets the interface font to Inter, then the system sans (base.css)', async () => {
    const css = await build(['font-sans']);
    expect(css).toMatch(/--font-sans:\s*'?"?Inter/);
  });

  it('self-hosts Inter: a font-face named Inter from files that exist, nothing from the web', () => {
    const faces = [...source.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/font-family:\s*['"]Inter['"]/);
      const url = /url\(['"]?([^'")]+)['"]?\)/.exec(face)?.[1];
      expect(url, face).toBeDefined();
      expect(url).not.toMatch(/^(?:https?:)?\/\//);
      expect(existsSync(new URL(url ?? '', new URL('globals.css', import.meta.url)))).toBe(true);
    }
    expect(source).not.toMatch(/https?:\/\//);
  });

  it('uses no other interface font', () => {
    const families = [...source.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1] ?? '');
    for (const family of families) expect(family).toMatch(/Inter|var\(--font-sans\)/);
  });
});
