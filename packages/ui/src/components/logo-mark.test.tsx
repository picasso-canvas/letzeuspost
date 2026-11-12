import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogoMark } from '@lzp/ui/components/logo-mark';

// The mark of the final logo (§03 Logo A, the crisp strike): docs/design/logos/letzeuspost/mark.svg is the source. The
// component draws the same shapes with the tokens for its colours, so it can't drift from the file or from the app's
// own gold and ink, and it reads the same in light and dark (the mark is the same in both: a gold tile, an ink bolt).
const source = readFileSync(
  new URL('../../../../docs/design/logos/letzeuspost/mark.svg', import.meta.url),
  'utf8',
);
const attribute = (markup: string, tag: string, name: string) =>
  new RegExp(`<${tag}\\b[^>]*?\\s${name}="([^"]*)"`).exec(markup)?.[1];

describe('the logo mark', () => {
  const markup = renderToStaticMarkup(<LogoMark />);

  it('draws the shapes of docs/design/logos/letzeuspost/mark.svg', () => {
    expect(attribute(markup, 'svg', 'viewBox')).toBe(attribute(source, 'svg', 'viewBox'));
    for (const name of ['x', 'y', 'width', 'height', 'rx']) {
      expect(attribute(markup, 'rect', name), name).toBe(attribute(source, 'rect', name));
    }
    expect(attribute(markup, 'path', 'd')).toBe(attribute(source, 'path', 'd'));
  });

  it('is gold with an ink bolt through the tokens, with no colour of its own', () => {
    expect(attribute(markup, 'rect', 'class')).toContain('fill-primary');
    expect(attribute(markup, 'path', 'class')).toContain('fill-primary-foreground');
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl|oklch|fill="/i);
  });

  it('is decorative unless it is given a name', () => {
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role=');
    const named = renderToStaticMarkup(<LogoMark title="LetZeusPost" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="LetZeusPost"');
    expect(named).not.toContain('aria-hidden');
  });

  it('takes its size from the caller, and is 24 px (size-6) when it is not told', () => {
    expect(attribute(markup, 'svg', 'class')).toContain('size-6');
    const big = renderToStaticMarkup(<LogoMark className="size-10" />);
    expect(attribute(big, 'svg', 'class')).toContain('size-10');
    expect(attribute(big, 'svg', 'class')).not.toContain('size-6');
  });
});
