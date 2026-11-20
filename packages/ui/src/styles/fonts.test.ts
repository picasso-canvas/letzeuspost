import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// #241 (Cerberus F1 on #240): the fonts check covers every stylesheet in the interface, not globals.css alone. A
// stylesheet that loads a font from the web, or names a font other than Inter and Hind Siliguri, fails here.

const ownFonts = new Set(['Inter', 'Hind Siliguri']);
/** The generic and system families `tokens/base.css`'s `--font-sans` stack uses. */
const systemFamilies = new Set([
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'sans-serif',
]);

const unquote = (value: string): string => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Splits a family list at the commas outside parentheses: `var(--x, y)` is one item. */
function splitFamilies(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let item = '';
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      items.push(item.trim());
      item = '';
    } else item += char;
  }
  return [...items, item.trim()].filter((entry) => entry !== '');
}

const allowedFamily = (family: string): boolean =>
  ownFonts.has(unquote(family)) ||
  systemFamilies.has(unquote(family)) ||
  /^var\(--font-[a-z0-9-]+\)$/.test(family);

/** Everything a stylesheet says about fonts that is not allowed; empty when it is clean. */
function fontProblems(css: string, dir: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const problems: string[] = [];

  // Nothing from the web: no http(s) or protocol-relative URL anywhere, which covers a remote @import and a remote src.
  for (const url of code.matchAll(/https?:|\/\/[^\s'")]*/g)) problems.push(`web URL: ${url[0]}`);

  for (const face of code.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = face[1] ?? '';
    const name = /font-family:\s*([^;]+)/.exec(body)?.[1];
    if (name === undefined || !ownFonts.has(unquote(name)))
      problems.push(`@font-face names ${name ?? 'no family'}, not Inter or Hind Siliguri`);
    const src = /src:\s*([^;]+)/.exec(body)?.[1] ?? '';
    const urls = [...src.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)].map((m) => m[1] ?? '');
    if (urls.length === 0 || /\blocal\(/.test(src))
      problems.push(`@font-face src is not a file: ${src}`);
    for (const url of urls)
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || !existsSync(join(dir, url)))
        problems.push(`@font-face src is not a local file that exists: ${url}`);
  }

  // `font` is a shorthand that can name a family too, and it can't be checked as a list: write `font-family`.
  if (/(?:^|[;{}\s])font\s*:/.test(code)) problems.push('font shorthand names a family');

  // A family in a declaration or in a token a theme turns into one (`--font-sans`; the weights and sub-properties
  // such as `--font-weight-body` and `--font-numbers--font-feature-settings` are not stacks).
  const declaration =
    /(?:^|[;{}\s])(font-family|--default(?:-mono)?-font-family|--font-(?!weight-)(?:[a-z0-9]+-)*[a-z0-9]+)\s*:\s*([^;}]+)/g;
  for (const [, property = '', value = ''] of code.matchAll(declaration))
    for (const family of splitFamilies(value))
      if (!allowedFamily(family)) problems.push(`${property} names ${family}`);

  return problems;
}

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every `.css` file under packages/ui/src and apps/web/src, found by walking them: no hand-kept list to forget. */
function stylesheets(): string[] {
  return ['packages/ui/src', 'apps/web/src'].flatMap((dir) =>
    readdirSync(join(repo, dir), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.css'))
      .map((file) => join(repo, dir, file)),
  );
}

describe('every stylesheet in packages/ui and apps/web', () => {
  const files = stylesheets();

  it('finds the stylesheets it is meant to check', () => {
    const found = files.map((file) => file.slice(repo.length));
    expect(found).toEqual(
      expect.arrayContaining([
        'packages/ui/src/styles/globals.css',
        'packages/ui/src/styles/components.css',
        'packages/ui/src/tokens/base.css',
        'packages/ui/src/tokens/theme.css',
        'packages/ui/src/tokens/dark.css',
        'apps/web/src/app/globals.css',
      ]),
    );
  });

  it('loads nothing from the web and names no font but Inter and Hind Siliguri', () => {
    for (const file of files) {
      const dir = file.slice(0, file.lastIndexOf('/'));
      expect(fontProblems(readFileSync(file, 'utf8'), dir), file).toEqual([]);
    }
  });
});

describe('the font check', () => {
  const dir = join(repo, 'packages/ui/src/styles');
  const problems = (css: string) => fontProblems(css, dir);

  it('passes the faces and stacks the interface uses', () => {
    expect(
      problems(`
        @font-face { font-family: 'Hind Siliguri'; font-weight: 400;
          src: url('../../node_modules/@fontsource/hind-siliguri/files/hind-siliguri-bengali-400-normal.woff2') format('woff2'); }
        @theme { --font-sans: 'Inter', 'Hind Siliguri', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
          --font-body: 'Inter'; --font-weight-body: 400; --font-numbers--font-feature-settings: 'tnum'; }
        :lang(bn) { font-family: 'Hind Siliguri', var(--font-sans); }
        body { font-family: var(--font-sans); }`),
    ).toEqual([]);
  });

  it('fails on a planted font-family: Roboto', () => {
    expect(problems('.card { font-family: Roboto; }')).not.toEqual([]);
    expect(problems(".card { font-family: 'Inter', Roboto, sans-serif; }")).not.toEqual([]);
    expect(problems(':root { --font-display: "Roboto", sans-serif; }')).not.toEqual([]);
    expect(problems('.card { font: 14px/1.5 Roboto; }')).not.toEqual([]);
  });

  it("fails on a planted @import url('https://fonts.googleapis.com/…')", () => {
    expect(
      problems("@import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');"),
    ).not.toEqual([]);
    expect(problems('@import "https://fonts.googleapis.com/css2?family=Inter";')).not.toEqual([]);
    expect(problems("@import '//fonts.googleapis.com/css2?family=Inter';")).not.toEqual([]);
  });

  it('fails on a web-hosted, protocol-relative, missing or non-file font source', () => {
    const face = (src: string) => `@font-face { font-family: 'Inter'; src: ${src}; }`;
    expect(problems(face("url('https://fonts.gstatic.com/inter.woff2')"))).not.toEqual([]);
    expect(problems(face("url('//fonts.gstatic.com/inter.woff2')"))).not.toEqual([]);
    expect(problems(face("url('./no-such-file.woff2')"))).not.toEqual([]);
    expect(problems(face('url(data:font/woff2;base64,AAAA)'))).not.toEqual([]);
    expect(problems(face("local('Inter')"))).not.toEqual([]);
  });

  it('fails on a @font-face named for another family', () => {
    expect(
      problems(
        "@font-face { font-family: 'Roboto'; src: url('../../node_modules/@fontsource/hind-siliguri/files/hind-siliguri-bengali-400-normal.woff2'); }",
      ),
    ).not.toEqual([]);
  });

  it('reads a stylesheet written to a temporary file the way it reads the repo', () => {
    const temp = mkdtempSync(join(tmpdir(), 'lzp-fonts-'));
    const file = join(temp, 'planted.css');
    writeFileSync(
      file,
      '.x { font-family: Roboto; }\n@import url("https://fonts.googleapis.com/x");',
    );
    expect(existsSync(file)).toBe(true);
    expect(fontProblems(readFileSync(file, 'utf8'), temp).length).toBeGreaterThanOrEqual(2);
  });
});
