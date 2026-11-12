import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as avatar from '@lzp/ui/components/avatar.stories';
import * as button from '@lzp/ui/components/button.stories';
import * as dropdownMenu from '@lzp/ui/components/dropdown-menu.stories';
import * as empty from '@lzp/ui/components/empty.stories';
import * as input from '@lzp/ui/components/input.stories';
import * as sheet from '@lzp/ui/components/sheet.stories';
import * as sidebar from '@lzp/ui/components/sidebar.stories';
import * as skeleton from '@lzp/ui/components/skeleton.stories';
import * as toast from '@lzp/ui/components/toast.stories';
import * as tooltip from '@lzp/ui/components/tooltip.stories';
import * as topBar from '@lzp/ui/components/top-bar.stories';

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

  // The approved invite card's "Email me a sign-in link" carries a mail icon before its words (#78, Iris F4).
  it('show the primary button with a Lucide icon at its start, as the invite card does', () => {
    const render = stories['WithIcon']?.render;
    if (render === undefined) throw new Error('the button has no WithIcon story');
    const markup = renderToStaticMarkup(render());
    expect(markup).toContain('data-icon="inline-start"');
    expect(markup).toContain('lucide-mail');
    expect(markup).toContain('aria-hidden="true"');
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

// The app frame's components (#205): the states each one has, and the tags that draw the pointer and key states.
describe('the dropdown menu stories', () => {
  it('open one menu by the keyboard, after tabbing to its trigger', () => {
    expect(storiesOf(dropdownMenu).KeyboardOpen?.tags).toEqual(['focus', 'keyboard-open']);
  });
});

describe('the top bar stories', () => {
  const stories = storiesOf(topBar);

  it('open the switcher by the keyboard, after tabbing to its button', () => {
    expect(stories.KeyboardOpen?.tags).toEqual(['focus', 'keyboard-open']);
  });

  it('have no empty switcher: the frame only exists inside a workspace (Athena, #75, 2026-11-11)', () => {
    expect(stories).not.toHaveProperty('Empty');
  });
});

describe.each([
  { name: 'avatar', module: avatar, states: ['Photo', 'Initials', 'Group'], hover: [], focus: [] },
  { name: 'skeleton', module: skeleton, states: ['PostCard', 'ListRow'], hover: [], focus: [] },
  {
    name: 'empty',
    module: empty,
    states: ['NoPostsYet', 'ErrorState'],
    hover: ['ActionHover'],
    focus: ['ActionFocus'],
  },
  {
    name: 'dropdown menu',
    module: dropdownMenu,
    states: ['Closed', 'Open', 'CheckboxAndRadio'],
    hover: ['TriggerHover'],
    focus: ['TriggerFocus', 'KeyboardOpen'],
  },
  { name: 'tooltip', module: tooltip, states: ['Open'], hover: [], focus: ['TriggerFocus'] },
  { name: 'sheet', module: sheet, states: ['Closed', 'Open'], hover: [], focus: [] },
  {
    name: 'toast',
    module: toast,
    states: ['Success', 'Info', 'ErrorState', 'Loading'],
    hover: [],
    focus: [],
  },
  {
    name: 'sidebar',
    module: sidebar,
    states: ['Expanded', 'Loading', 'NoPinnedBrands', 'NarrowRow'],
    hover: ['ItemHover'],
    focus: ['ItemFocus'],
  },
  // The top bar and its workspace switcher (#75): closed, hovered, focused, open, opened by the keyboard, disabled,
  // loading, and with the list failed to load (closed, and open to show why).
  {
    name: 'top bar',
    module: topBar,
    states: [
      'Default',
      'Logo',
      'Open',
      'Disabled',
      'Loading',
      'ErrorState',
      'ErrorOpen',
      'LongName',
    ],
    hover: ['TriggerHover'],
    focus: ['TriggerFocus', 'KeyboardOpen'],
  },
])('the $name stories', ({ module, states, hover, focus }) => {
  const stories = storiesOf(module);

  it('show each state that applies', () => {
    for (const name of states) expect(stories, name).toHaveProperty(name);
  });

  it('tag only the hovered and focused states, with the tags the gallery tests know', () => {
    const tagged = (tag: string) =>
      Object.entries(stories)
        .filter(([, story]) => (story.tags ?? []).includes(tag))
        .map(([name]) => name);
    expect(tagged('hover')).toEqual(hover);
    expect(tagged('focus')).toEqual(focus);
    for (const [name, story] of Object.entries(stories))
      for (const tag of story.tags ?? [])
        expect(['hover', 'focus', 'keyboard-open'], name).toContain(tag);
  });
});
