import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as stories from '@lzp/ui/components/button.stories';
import { MailIcon } from '@lzp/ui/components/icons';

// The approved invite card's "Email me a sign-in link" carries a mail icon before its words (#78, Iris F4). The gallery
// shows the gallery Button that way, so a screen has one pattern to copy.
describe('the button with an icon', () => {
  // The gallery tests read a story as a function with no arguments, as stories.test.ts does.
  const story = Object.fromEntries(Object.entries(stories)) as Record<
    string,
    { render?: () => ReactElement }
  >;
  const render = story['WithIcon']?.render;
  if (render === undefined) throw new Error('the button has no WithIcon story');
  const markup = renderToStaticMarkup(render());

  it('has a Lucide icon at its start, which a screen reader skips', () => {
    expect(markup).toContain('lucide-mail');
    expect(markup).toContain('data-icon="inline-start"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('is the same icon a screen takes from @lzp/ui, so the app needs no icon package of its own', () => {
    const fromScreen = renderToStaticMarkup(
      <MailIcon data-icon="inline-start" aria-hidden="true" />,
    );
    expect(markup).toContain(fromScreen);
  });

  it('keeps the words after the icon', () => {
    expect(markup).toMatch(/<svg[^>]*>.*<\/svg>Email me a sign-in link/);
  });
});
