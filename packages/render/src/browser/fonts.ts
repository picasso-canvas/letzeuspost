// The font checks (§08 No silent fallbacks): every font the page declares is loaded before anything is measured, and
// one that fails fails the render by name; after rendering, Chrome reports which fonts drew each text block
// (`CSS.getPlatformFontsForNode`), and a font the page didn't load is an error in the result.

/** A node of the DevTools protocol's `DOM.getDocument` tree, the fields this file reads. */
export type DomNode = {
  nodeId: number;
  nodeType: number;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: DomNode[];
};

export type TextBlock = { nodeId: number; block: string };

export type UsedFont = { family: string; custom: boolean; glyphs: number };

export type BlockFonts = { block: string; fonts: UsedFont[] };

export type FontFallback = {
  code: 'font-fallback';
  block: string;
  family: string;
  glyphs: number;
  message: string;
};

const ELEMENT = 1;
const TEXT = 3;
/** Elements whose text is never drawn. */
const NOT_DRAWN = new Set(['script', 'style', 'noscript', 'template']);

const attribute = (node: DomNode, name: string): string | undefined => {
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2)
    if (attributes[i] === name) return attributes[i + 1];
  return undefined;
};

/** `h1#id.class.other`: an element as a CSS selector names it. */
function step(node: DomNode): string {
  const id = attribute(node, 'id');
  const classes = (attribute(node, 'class') ?? '').split(/\s+/).filter((name) => name !== '');
  return [
    node.localName ?? '',
    id === undefined ? '' : `#${id}`,
    ...classes.map((c) => `.${c}`),
  ].join('');
}

const findBody = (node: DomNode): DomNode | undefined =>
  node.nodeType === ELEMENT && node.localName === 'body'
    ? node
    : (node.children ?? []).reduce<DomNode | undefined>(
        (found, child) => found ?? findBody(child),
        undefined,
      );

/**
 * The elements under `<body>` that hold text of their own (a text child that isn't blank), in page order, each named by
 * its path from the body (`main#slide > h1.title`). Chrome reports the fonts of an element's own text children, so
 * these are the blocks whose fonts are read.
 */
export function textBlocks(document: DomNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  const walk = (node: DomNode, path: readonly string[]) => {
    for (const child of node.children ?? []) {
      if (child.nodeType !== ELEMENT || NOT_DRAWN.has(child.localName ?? '')) continue;
      const here = [...path, step(child)];
      const ownText = (child.children ?? []).some(
        (grandchild) => grandchild.nodeType === TEXT && (grandchild.nodeValue ?? '').trim() !== '',
      );
      if (ownText) blocks.push({ nodeId: child.nodeId, block: here.join(' > ') });
      walk(child, here);
    }
  };
  const body = findBody(document);
  if (body !== undefined) walk(body, []);
  return blocks;
}

/**
 * Every font that drew a glyph without being one the page loaded (Chrome's `isCustomFont` is false for a system font):
 * a Latin font drawing Bangla, or a glyph no loaded font has. Each is an error (§08 No silent fallbacks).
 */
export function fallbacks(blocks: readonly BlockFonts[]): FontFallback[] {
  return blocks.flatMap(({ block, fonts }) =>
    fonts
      .filter((font) => !font.custom && font.glyphs > 0)
      .map(({ family, glyphs }) => ({
        code: 'font-fallback' as const,
        block,
        family,
        glyphs,
        message: `${block}: ${String(glyphs)} ${glyphs === 1 ? 'glyph was' : 'glyphs were'} drawn by "${family}", a font the page didn’t load`,
      })),
  );
}

/** The weight and style words a font file adds to its family's name: "Nunito ExtraLight", "Hind Siliguri Light". */
const STYLE_WORDS =
  /^(?: (?:Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Normal|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Italic))*$/;

/**
 * A web font's family as the manifest names it. Chrome names a font by its file's own name table, which can add a
 * weight to the family (every Nunito file says "Nunito ExtraLight"); the manifest family it starts with, followed only by
 * weight and style words, is its name. A font the manifest doesn't have keeps the name Chrome gave.
 */
export function manifestFamily(reported: string, families: readonly string[]): string {
  // The longest first, so "Baloo Da 2 Bold" can never be read as a weight of a shorter family.
  const longestFirst = [...families].sort((a, b) => b.length - a.length);
  return (
    longestFirst.find(
      (family) => reported.startsWith(family) && STYLE_WORDS.test(reported.slice(family.length)),
    ) ?? reported
  );
}

/** The reason a render fails when fonts didn't load, naming each one; undefined when all loaded. */
export function fontLoadFailure(
  failed: readonly { family: string; weight: string }[],
): string | undefined {
  if (failed.length === 0) return undefined;
  return failed
    .map(
      ({ family, weight }, i) =>
        `${i === 0 ? 'The' : 'the'} font "${family.replace(/^(["'])(.*)\1$/, '$2')}" (weight ${weight}) didn’t load`,
    )
    .join('; ');
}
