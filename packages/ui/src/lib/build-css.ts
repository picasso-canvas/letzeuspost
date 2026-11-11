import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

// For the tests that check what a component's classes do (#75): globals.css compiled the way the Vite plugin does,
// with the CSS for the given utility classes. Tailwind and its animate plugin are packages/ui's own dependencies.
const stylesDir = fileURLToPath(new URL('../styles/', import.meta.url)).replace(/\/$/, '');
const uiDir = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');

/** Where a bare `@import 'name'` lives: the package's own dependencies, as a bundler finds them. */
const packages: Record<string, string> = {
  tailwindcss: `${uiDir}node_modules/tailwindcss/index.css`,
  'tw-animate-css': `${uiDir}node_modules/tw-animate-css/dist/tw-animate.css`,
};

export async function buildCss(candidates: string[]): Promise<string> {
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
