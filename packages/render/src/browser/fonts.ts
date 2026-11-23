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

export function textBlocks(_document: DomNode): TextBlock[] {
  throw new Error('not built yet');
}

export function fallbacks(_blocks: readonly BlockFonts[]): FontFallback[] {
  throw new Error('not built yet');
}

export function fontLoadFailure(
  _failed: readonly { family: string; weight: string }[],
): string | undefined {
  throw new Error('not built yet');
}
