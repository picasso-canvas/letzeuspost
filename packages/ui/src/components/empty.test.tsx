import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyTitle } from '@lzp/ui/components/empty';

// An empty state's title is a real heading, so screen-reader users can jump to it (Iris F2 on #206).
describe('EmptyTitle', () => {
  it('is an h2 with the h2 type token by default', () => {
    const html = renderToStaticMarkup(<EmptyTitle>No posts this week</EmptyTitle>);
    expect(html).toMatch(/^<h2 [^>]*data-slot="empty-title"/);
    expect(html).toMatch(/class="[^"]*\btext-h2\b/);
  });

  it('takes another level from the caller', () => {
    const html = renderToStaticMarkup(<EmptyTitle render={<h3 />}>No posts this week</EmptyTitle>);
    expect(html).toMatch(/^<h3 [^>]*data-slot="empty-title"/);
    expect(html).toMatch(/class="[^"]*\btext-h2\b/);
  });
});
