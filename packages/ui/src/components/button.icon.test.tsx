import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as stories from '@lzp/ui/components/button.stories';

// The approved invite card's "Email me a sign-in link" carries a mail icon before its words (#78, Iris F4). The gallery
// shows the gallery Button that way, so a screen has one pattern to copy.
describe('the button with an icon', () => {
  const render = stories.WithIcon.render;
  const markup = renderToStaticMarkup(render());

  it('has a Lucide icon at its start, which a screen reader skips', () => {
    expect(markup).toContain('lucide-mail');
    expect(markup).toContain('data-icon="inline-start"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('keeps the words after the icon', () => {
    expect(markup).toMatch(/<svg[^>]*>.*<\/svg>Email me a sign-in link/);
  });
});
