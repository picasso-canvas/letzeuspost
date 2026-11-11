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

  it('self-hosts its fonts: Inter, and Hind Siliguri for Bangla, from files that exist, nothing from the web', () => {
    const faces = [...source.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/font-family:\s*['"](?:Inter|Hind Siliguri)['"]/);
      const url = /url\(['"]?([^'")]+)['"]?\)/.exec(face)?.[1];
      expect(url, face).toBeDefined();
      expect(url).not.toMatch(/^(?:https?:)?\/\//);
      expect(existsSync(new URL(url ?? '', new URL('globals.css', import.meta.url)))).toBe(true);
    }
    expect(source).not.toMatch(/https?:\/\//);
  });

  // Zeus, 2026-11-11 (#228): Hind Siliguri carries Bangla only, in the weights the type scale reaches (400 to 700).
  it('gives Hind Siliguri the Bengali range only, in weights 400, 500, 600 and 700', () => {
    const hind = [...source.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => m[1] ?? '')
      .filter((face) => /font-family:\s*['"]Hind Siliguri['"]/.test(face));
    expect(hind.map((face) => /font-weight:\s*(\d+)/.exec(face)?.[1]).sort()).toEqual([
      '400',
      '500',
      '600',
      '700',
    ]);
    for (const face of hind) {
      const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1] ?? '';
      expect(range).toMatch(/U\+0980-09FF/i);
      expect(range).not.toMatch(/U\+0000|U\+0020-007F|U\+00/i);
    }
  });

  it('builds every named utility components.css declares, so a typo in one fails here (#205)', async () => {
    const declared = readFileSync(new URL('components.css', import.meta.url), 'utf8');
    const names = [...declared.matchAll(/@utility\s+([\w-]+)/g)].map((m) => m[1] ?? '');
    expect(names.length).toBeGreaterThan(10);
    const css = await build(names);
    for (const name of names)
      expect(css, name).toMatch(new RegExp(`\\.${name}\\s*\\{[^}]*[a-z-]+:`));
  });

  it("builds the components' named utilities from components.css, with no colour of their own (#205)", async () => {
    const css = await build([
      'z-toast',
      'toast-stack',
      'toast-transition',
      'data-expanded:toast-expanded',
      'tooltip-arrow-offset',
      'shadow-sidebar-outline',
      'data-active:shadow-sidebar-current',
    ]);
    expect(css).toMatch(/\.z-toast\s*\{[^}]*z-index:\s*calc\(1000 - var\(--toast-index\)\)/);
    expect(css).toMatch(/\.toast-stack\s*\{[^}]*transform:/);
    expect(css).toMatch(/\.shadow-sidebar-outline\s*\{[^}]*var\(--color-border\)/);
    expect(css).toMatch(
      /shadow-sidebar-current[^{]*\{[^}]*inset 2px 0 0 var\(--color-foreground\)/,
    );
    // The toast moves for DESIGN.md's default time on the default curve (Iris F2 on #206), and nothing moves under
    // reduced motion (§05).
    expect(css).toMatch(
      /\.toast-transition\s*\{[^}]*transition-duration:\s*var\(--default-transition-duration\)/,
    );
    expect(css).not.toMatch(/cubic-bezier\(0\.22/);
    expect(css).toMatch(
      /\.toast-transition\s*\{[^}]*@media \(prefers-reduced-motion: reduce\)\s*\{\s*transition:\s*none/,
    );
    // Comments aside (they cite issues like #205), no raw colour, but for the one the skeleton's shimmer takes from the
    // mockup's `.shimmer` (Athena's decision 1 on #75, 2026-11-11): its white band, at 35%, exactly. Any other fails.
    const rules = readFileSync(new URL('components.css', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace('rgb(255 255 255 / 35%) 50%', '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i);
  });

  it('uses no other interface font', () => {
    const families = [...source.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1] ?? '');
    for (const family of families) expect(family).toMatch(/Inter|Hind Siliguri|var\(--font-sans\)/);
  });
});
