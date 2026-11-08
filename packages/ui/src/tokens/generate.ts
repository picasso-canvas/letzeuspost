// The design tokens (§21, #70): `pnpm tokens` pipes `design.md export --format css-tailwind DESIGN.md` into this file,
// which writes theme.css (the light tokens as Tailwind's @theme) and dark.css (each `<name>-dark` partner on its light
// name under `.dark`). DESIGN.md's format has no light/dark modes, so the dark values live there as partners.
// CI regenerates both files and fails if they differ from the committed ones.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEADER =
  '/* Generated from DESIGN.md by packages/ui/src/tokens/generate.ts (pnpm tokens). Don’t edit. */';
const DECLARATION = /^\s*--([\w-]+):\s*(.+);\s*$/;

export interface Themes {
  theme: string;
  dark: string;
}

export function splitThemes(exported: string): Themes {
  const lines = exported.trim().split('\n');
  if (lines[0]?.trim() !== '@theme {' || lines.at(-1)?.trim() !== '}')
    throw new Error('expected one @theme { … } block from design.md export');

  const light: string[] = [];
  const lightColours = new Set<string>();
  const darkValues = new Map<string, string>();
  for (const line of lines.slice(1, -1)) {
    const match = DECLARATION.exec(line);
    if (!match) throw new Error(`unexpected line in design.md export: ${line}`);
    const [, name = '', value = ''] = match;
    const colour = /^color-(.+)$/.exec(name)?.[1];
    if (colour?.endsWith('-dark')) darkValues.set(colour.slice(0, -'-dark'.length), value);
    else {
      if (colour !== undefined) lightColours.add(colour);
      light.push(`  --${name}: ${value};`);
    }
  }

  for (const colour of lightColours)
    if (!darkValues.has(colour)) throw new Error(`${colour} has no dark partner (${colour}-dark)`);
  for (const colour of darkValues.keys())
    if (!lightColours.has(colour)) throw new Error(`${colour}-dark has no light colour`);

  const dark = [...lightColours].map((c) => `  --color-${c}: ${darkValues.get(c) ?? ''};`);
  return {
    theme: `${HEADER}\n@theme {\n${light.join('\n')}\n}\n`,
    dark: `${HEADER}\n.dark {\n${dark.join('\n')}\n}\n`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { theme, dark } = splitThemes(readFileSync(0, 'utf8'));
  writeFileSync(new URL('theme.css', import.meta.url), theme);
  writeFileSync(new URL('dark.css', import.meta.url), dark);
}
