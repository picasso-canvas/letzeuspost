// /app's loading state (Iris F4 on #79): while the guard opens the workspace, the frame and the Inbox are drawn as the
// gallery's skeletons (§04: "Loading: skeletons"), and a screen reader hears that they are loading, in en.json's words.
// It holds nothing of the person or the workspace: it is drawn before the guard has answered.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { messages } from '../messages.ts';
import { AppFrameSkeleton, InboxSkeleton } from './app-frame-skeleton.tsx';

const { frame, inbox } = messages;

/** The text a screen reader meets in `html`, piece by piece. */
const texts = (html: string) =>
  html
    .split(/<[^>]*>/)
    .map((t) => t.trim())
    .filter((t) => t !== '');

describe('the Inbox on its way', () => {
  const html = renderToStaticMarkup(<InboxSkeleton />);

  it('keeps the page’s heading and line, and says the rest is loading', () => {
    expect(html).toMatch(new RegExp(`<h1[^>]*>${inbox.heading}</h1>`));
    expect(html).toContain(inbox.intro);
    expect(html).toMatch(new RegExp(`role="status"[^>]*>(?:<[^>]*>)*${inbox.loading}`));
    expect(html).toContain('aria-busy="true"');
  });

  it('is the final empty state’s one box, drawn as skeletons, so nothing jumps when it loads', () => {
    // Exactly the Empty box the page draws: the same single box, with the same spacing classes, and no list rows.
    expect((html.match(/data-slot="empty"/g) ?? []).length).toBe(1);
    expect((html.match(/data-slot="empty-header"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('border-b p-4');
    expect((html.match(/data-slot="skeleton"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The box is the status region, so the screen reader hears it once.
    expect(html).toMatch(/<div[^>]*data-slot="empty"[^>]*role="status"/);
    expect((html.match(/role="status"/g) ?? []).length).toBe(1);
  });

  it('holds the empty state’s own words out of sight, so each skeleton is as tall as the text it stands for', () => {
    // The copy is invisible and hidden from a screen reader: it only gives the skeleton its wrapped size at every width.
    for (const words of [inbox.empty.heading, inbox.empty.body]) {
      expect(html).toMatch(
        new RegExp(`aria-hidden="true"[^>]*>(?:<[^>]*>)*<span class="invisible">${words}</span>`),
      );
    }
  });

  it('writes only en.json’s words', () => {
    expect(texts(html).sort()).toEqual(
      [inbox.heading, inbox.intro, inbox.loading, inbox.empty.heading, inbox.empty.body].sort(),
    );
  });
});

describe('the frame on its way', () => {
  const html = renderToStaticMarkup(<AppFrameSkeleton />);

  it('draws the sidebar, the top bar and the Inbox as the gallery’s skeletons', () => {
    expect(html).toContain('data-slot="sidebar"');
    expect(html).toContain('data-slot="sidebar-menu-skeleton"');
    expect(html).toContain('data-slot="top-bar"');
    expect(html).toContain('data-slot="workspace-switcher-skeleton"');
    expect(html).toContain('<main');
    expect(html).toContain(inbox.loading);
  });

  it('says the workspaces are loading, and shows nothing of a person or a workspace', () => {
    expect(texts(html).sort()).toEqual(
      [
        messages.app.name,
        frame.switcher.loading,
        inbox.heading,
        inbox.intro,
        inbox.loading,
        inbox.empty.heading,
        inbox.empty.body,
      ].sort(),
    );
  });
});
