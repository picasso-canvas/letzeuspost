import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as button from '@lzp/ui/components/button.stories';
import * as input from '@lzp/ui/components/input.stories';

// §21: every component is in the gallery in every state that applies to it (default, hover, focus, disabled, empty,
// loading, error). The gallery tests act on the `hover` and `focus` tags, so a state with the wrong tag would be drawn
// as the default and pass for the wrong reason.
interface Story {
  tags?: string[];
  render?: () => ReactElement;
}
/** The named exports of a stories file: its stories (the default export is the component's meta). */
const storiesOf = (module: object): Record<string, Story> =>
  Object.fromEntries(Object.entries(module).filter(([name]) => name !== 'default'));

describe('the button stories', () => {
  const stories = storiesOf(button);

  it('show all four variants, disabled, and loading', () => {
    expect(Object.keys(stories)).toEqual(
      expect.arrayContaining(['Variants', 'Disabled', 'Loading']),
    );
  });

  it.each(['Primary', 'Secondary', 'Ghost', 'Destructive'])(
    'draw %s hovered and focused',
    (name) => {
      expect(stories[`${name}Hover`]?.tags).toEqual(['hover']);
      expect(stories[`${name}Focus`]?.tags).toEqual(['focus']);
    },
  );
});

describe('the input stories', () => {
  const stories = storiesOf(input);

  it('show empty, filled, disabled, loading and error', () => {
    for (const name of ['Empty', 'Filled', 'Disabled', 'Loading', 'ErrorState'])
      expect(stories, name).toHaveProperty(name);
  });

  it('draw the input hovered, focused, and focused with its error', () => {
    expect(stories.Hover?.tags).toEqual(['hover']);
    expect(stories.Focus?.tags).toEqual(['focus']);
    expect(stories.ErrorFocus?.tags).toEqual(['focus']);
  });

  it('tags no other story, so only the states that need a pointer or a key get one', () => {
    const tagged = Object.entries(stories)
      .filter(([, story]) => (story.tags ?? []).length > 0)
      .map(([name]) => name);
    expect(tagged.sort()).toEqual(['ErrorFocus', 'Focus', 'Hover']);
  });

  const html = (name: string): string => {
    const render = stories[name]?.render;
    if (render === undefined) throw new Error(`no ${name} story to render`);
    return renderToStaticMarkup(render());
  };

  it("set the help text small and faint, like the mockup's hint, in every state", () => {
    for (const name of Object.keys(stories)) {
      const help = /<p[^>]*data-slot="field-description"[^>]*class="([^"]*)"/.exec(html(name));
      const classes = help?.[1]?.split(' ') ?? [];
      expect(classes, name).toContain('text-meta');
      expect(classes, name).toContain('text-faint');
    }
  });

  it("show the empty field's placeholder as an example, so it can't pass for a typed value", () => {
    for (const name of ['Empty', 'Loading']) {
      expect(html(name), name).toContain('placeholder="e.g. Golpo Café"');
      expect(html(name), name).not.toContain('placeholder="Golpo Café"');
    }
    expect(html('Filled')).toContain('value="Golpo Café"');
  });
});
