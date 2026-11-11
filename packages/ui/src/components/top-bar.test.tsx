import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Building2Icon, CheckIcon } from 'lucide-react';
import { Avatar } from '@lzp/ui/components/avatar';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@lzp/ui/components/dropdown-menu';
import {
  TopBar,
  TopBarEnd,
  WorkspaceSwitcher,
  WorkspaceSwitcherSkeleton,
  workspaceRows,
} from '@lzp/ui/components/top-bar';

// §04's top bar and §15's workspace switcher: "a switcher in the top bar lists the workspaces a person belongs to, with
// their role in each". Every word on them comes from the caller (§21: all interface text lives in
// apps/web/messages/en.json).
const northwind = { id: 'w1', name: 'Northwind Social', role: 'Admin' };
const kite = { id: 'w2', name: 'Kite & Co', role: 'Editor' };
const workspaces = [northwind, kite, { id: 'w3', name: 'বাংলা স্টুডিও', role: 'Viewer' }];
const words = {
  menuLabel: 'MENU: workspaces',
  currentLabel: 'CURRENT',
  note: 'NOTE: each workspace is separate',
};

describe('the workspace list', () => {
  it('lists every workspace the person belongs to, in order, with the role in each', () => {
    const rows = workspaceRows(workspaces, 'w1', words.currentLabel);
    expect(rows.map((row) => row.name)).toEqual(workspaces.map((w) => w.name));
    expect(rows.map((row) => row.detail)).toEqual(['Admin · CURRENT', 'Editor', 'Viewer']);
  });

  it('marks the current workspace, and only that one', () => {
    for (const { id } of workspaces) {
      const rows = workspaceRows(workspaces, id, words.currentLabel);
      expect(rows.filter((row) => row.current).map((row) => row.id)).toEqual([id]);
    }
  });

  it('marks none when the current workspace is not in the list, and never two', () => {
    expect(workspaceRows(workspaces, 'gone', words.currentLabel).some((r) => r.current)).toBe(
      false,
    );
    expect(workspaceRows(workspaces, undefined, words.currentLabel).some((r) => r.current)).toBe(
      false,
    );
    const twice = [...workspaces, { id: 'w1', name: 'Northwind again', role: 'Owner' }];
    expect(workspaceRows(twice, 'w1', words.currentLabel).filter((r) => r.current)).toHaveLength(1);
  });

  it('keeps each workspace’s own logo, and gives none to one without', () => {
    const rows = workspaceRows([{ ...northwind, logo: '/logo.svg' }, kite], 'w1', 'x');
    expect(rows.map((row) => row.logo)).toEqual(['/logo.svg', undefined]);
  });

  it('gives a workspace no colour of its own: its logo or its initials, nothing else (Iris F1, round 3)', () => {
    const [row] = workspaceRows([{ ...northwind, logo: '/logo.svg' }], 'w1', 'x');
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'current',
      'detail',
      'id',
      'logo',
      'name',
      'role',
    ]);
  });
});

const html = (props: Partial<Parameters<typeof WorkspaceSwitcher>[0]> = {}): string =>
  renderToStaticMarkup(
    <WorkspaceSwitcher {...words} workspaces={workspaces} currentId="w1" {...props} />,
  );

/** The visible text of some markup, one string per text node, and the text in its labelling attributes. */
function wordsIn(markup: string): string[] {
  const text = markup
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  const attributes = [...markup.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map(
    (m) => m[1] ?? '',
  );
  return [...text, ...attributes].map((t) => t.replaceAll('&amp;', '&'));
}

describe('the workspace switcher, closed', () => {
  it('is a button you can Tab to and press, showing the current workspace', () => {
    const markup = html();
    expect(markup).toMatch(/^<button\b/);
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Northwind Social');
    // Not the others, until it is opened.
    expect(markup).not.toContain('Kite');
  });

  it('is named by the text it shows, with no label of its own to disagree with it (WCAG 2.5.3, axe label-content-name-mismatch)', () => {
    for (const props of [
      {},
      { disabled: true },
      { error: { message: 'ERR', retryLabel: 'RETRY' } },
    ]) {
      const button = /^<button\b[^>]*>/.exec(html(props))?.[0] ?? '';
      expect(button, JSON.stringify(props)).not.toMatch(/aria-label(?:ledby)?=/);
    }
  });

  it('draws the initials on the muted token surface, with no colour of its own (Iris F1, round 3)', () => {
    const markup = html();
    const mark = /<span[^>]*data-slot="avatar-fallback"[^>]*>/.exec(markup)?.[0] ?? '';
    const classes = /class="([^"]*)"/.exec(mark)?.[1]?.split(' ') ?? [];
    expect(classes).toContain('bg-muted');
    expect(classes).toContain('text-muted-foreground');
    expect(markup).not.toContain('style=');
  });

  it.each(['theme.css', 'dark.css'])(
    'keeps the initials at 4.5:1 on their surface in the generated tokens (%s)',
    (file) => {
      const css = readFileSync(new URL(`../tokens/${file}`, import.meta.url), 'utf8');
      const token = (name: string): string => {
        const hex = new RegExp(`--color-${name}:\\s*#([0-9a-f]{6});`, 'i').exec(css)?.[1];
        if (hex === undefined) throw new Error(`no --color-${name} in ${file}`);
        return hex;
      };
      const luminance = (hex: string): number => {
        const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
          const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [light, dark] = [luminance(token('muted')), luminance(token('muted-foreground'))].sort(
        (a, b) => b - a,
      );
      expect(((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('sets the workspace name at weight 600 on DESIGN.md’s scale (Iris F2)', () => {
    const name = /<span[^>]*class="([^"]*)"[^>]*>Northwind Social<\/span>/.exec(html())?.[1] ?? '';
    expect(name.split(' ')).toContain('font-(weight:--font-weight-h3)');
    const tokens = readFileSync(new URL('../tokens/theme.css', import.meta.url), 'utf8');
    expect(/--font-weight-h3:\s*(\d+)/.exec(tokens)?.[1]).toBe('600');
  });

  it('shows the initials when the workspace has no logo, and until its logo has loaded', () => {
    // Base UI draws the image only once the browser has it, so a server render (and a logo that fails) shows the initials.
    expect(html()).toContain('>NS<');
    const withLogo = html({ workspaces: [{ ...northwind, logo: '/logo.svg' }] });
    expect(withLogo).toContain('>NS<');
    expect(withLogo).not.toContain('<img');
  });

  it('hides the mark from a screen reader: the name is beside it', () => {
    expect(html()).toMatch(
      /<span[^>]*aria-hidden="true"[^>]*data-slot="avatar"|data-slot="avatar"[^>]*aria-hidden="true"/,
    );
  });

  it('can be disabled, as a native button, so no key or click opens it', () => {
    expect(html({ disabled: true })).toMatch(/^<button\b[^>]*\bdisabled=""/);
    expect(html()).not.toMatch(/^<button\b[^>]*\bdisabled=""/);
  });

  it('keeps the current workspace on show when the list could not be loaded, and tells a screen reader why', () => {
    const markup = html({ error: { message: 'ERR: could not load', retryLabel: 'RETRY' } });
    expect(markup).toContain('Northwind Social');
    expect(markup).toMatch(/^<button\b/);
    // The warning icon is only drawn; the caller's message is read after the name, inside the button.
    expect(/^<button\b[\s\S]*?<\/button>/.exec(markup)?.[0]).toMatch(
      /class="sr-only"[^>]*>ERR: could not load</,
    );
  });

  it('holds no words of its own: every word is the caller’s or a workspace’s', () => {
    const allowed = new Set([...Object.values(words), 'NS', 'Northwind Social']);
    for (const props of [
      {},
      { disabled: true },
      { error: { message: 'ERR', retryLabel: 'RETRY' } },
    ]) {
      const found = wordsIn(html(props)).filter((w) => !allowed.has(w) && w !== 'ERR');
      expect(found, JSON.stringify(props)).toEqual([]);
    }
  });
});

interface ItemProps {
  onClick?: () => void;
  value?: string;
  closeOnClick?: boolean;
  children?: ReactNode;
}

interface GroupProps {
  value: string;
  onValueChange: (id: string) => void;
}

/** The elements of one component type in a tree of React elements (the open menu is drawn in a portal, in a browser). */
function elementsOfType<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) {
    return (node as ReactNode[]).flatMap((child) => elementsOfType<P>(child, type));
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as unknown as ReactElement<P>] : [];
  return [...own, ...elementsOfType<P>(node.props.children, type)];
}

/** The menu's plain items: the way out of a list that failed to load. */
const itemsOf = (node: ReactNode): ReactElement<ItemProps>[] =>
  elementsOfType<ItemProps>(node, DropdownMenuItem);

describe('choosing a workspace', () => {
  // The rows are a radio group inside the menu (`menuitemradio` with `aria-checked`, Athena's decision on #75): its
  // `onValueChange` runs for a click, and for Enter and Space on the focused row, so it is one path for the mouse and
  // the keyboard. The arrow keys, Home, End and Escape are the menu's own (Base UI).
  const chosen = vi.fn();
  const tree = WorkspaceSwitcher({ ...words, workspaces, currentId: 'w1', onSelect: chosen });
  const items = elementsOfType<ItemProps>(tree, DropdownMenuRadioItem);
  const [group] = elementsOfType<GroupProps>(tree, DropdownMenuRadioGroup);

  it('has one radio row for each workspace, in order', () => {
    expect(items.map((item) => item.props.value)).toEqual(workspaces.map((w) => w.id));
  });

  it('checks the current workspace, and only that one, by the group’s value', () => {
    expect(group?.props.value).toBe('w1');
  });

  it('closes the menu when a row is chosen, which a radio row does not do by itself', () => {
    expect(items.map((item) => item.props.closeOnClick)).toEqual([true, true, true]);
  });

  /** Every element in a tree of React elements, in order. */
  const elementsIn = (node: ReactNode): ReactElement<{ children?: ReactNode }>[] => {
    if (Array.isArray(node)) return node.flatMap(elementsIn);
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [node, ...elementsIn(node.props.children)];
  };

  it('draws the mockup’s rows (Iris F3): a check on the current one, a building on the others, no avatar', () => {
    const rows = items.map((item) => elementsIn(item.props.children).map((el) => el.type));
    expect(rows[0]?.[0]).toBe(CheckIcon);
    expect(rows[1]?.[0]).toBe(Building2Icon);
    expect(rows[2]?.[0]).toBe(Building2Icon);
    for (const row of rows) {
      expect(row).not.toContain(Avatar);
      expect(row.filter((type) => type === CheckIcon || type === Building2Icon)).toHaveLength(1);
    }
  });

  /** The class names of the span that holds a workspace's name, in a menu row. */
  const nameClassesInRow = (row: ReactElement<ItemProps> | undefined, name: string): string[] =>
    elementsIn(row?.props.children)
      .filter((el) => el.type === 'span' && el.props.children === name)
      .flatMap((el) => String((el.props as { className?: string }).className).split(' '));

  it('wraps a long name in its row instead of cutting it, at the same type and spacing (Iris F1 on #221)', () => {
    for (const [index, workspace] of workspaces.entries()) {
      const classes = nameClassesInRow(items[index], workspace.name);
      expect(classes, workspace.name).toContain('wrap-break-word');
      expect(
        classes.filter((c) => /^(truncate|line-clamp-|text-ellipsis|whitespace-nowrap)/.test(c)),
      ).toEqual([]);
      // Wrapping is all that changes: no size, weight or spacing of its own on the name.
      expect(
        classes.filter((c) => /^(text-|font-|leading-|tracking-|p[xytblr]?-|m[xytblr]?-)/.test(c)),
      ).toEqual([]);
    }
  });

  it('keeps the ellipsis on the button, where one line is all there is room for', () => {
    const name = /<span[^>]*class="([^"]*)"[^>]*>Northwind Social<\/span>/.exec(html())?.[1] ?? '';
    expect(name.split(' ')).toContain('truncate');
  });

  it('closes the list with the caller’s note, and leaves it out of a list that failed to load', () => {
    const notes = (props: object) =>
      elementsIn(WorkspaceSwitcher({ ...words, workspaces, currentId: 'w1', ...props })).filter(
        (el) => el.type === 'div' && el.props.children === words.note,
      );
    expect(notes({})).toHaveLength(1);
    expect(notes({ error: { message: 'ERR', retryLabel: 'RETRY' } })).toHaveLength(0);
  });

  it('switches to the workspace chosen, whoever chooses it and however', () => {
    group?.props.onValueChange('w2');
    group?.props.onValueChange('w3');
    expect(chosen.mock.calls).toEqual([['w2'], ['w3']]);
  });

  it('does nothing when the current workspace is chosen again', () => {
    chosen.mockClear();
    group?.props.onValueChange('w1');
    expect(chosen).not.toHaveBeenCalled();
  });

  it('tries again when the list failed to load and the person asks', () => {
    const onRetry = vi.fn();
    const [retry, ...rest] = itemsOf(
      WorkspaceSwitcher({
        ...words,
        workspaces,
        currentId: 'w1',
        error: { message: 'ERR', retryLabel: 'RETRY', onRetry },
      }),
    );
    // Instead of the workspaces, the way out: nothing else to choose.
    expect(rest).toEqual([]);
    retry?.props.onClick?.();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('the workspace switcher, loading', () => {
  const markup = renderToStaticMarkup(<WorkspaceSwitcherSkeleton label="LOADING: workspaces" />);

  it('shows the shape of the switcher while it is on its way, and says so to a screen reader', () => {
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/data-slot="skeleton"/g)).toHaveLength(2);
    expect(wordsIn(markup)).toEqual(['LOADING: workspaces']);
  });
});

describe('the top bar', () => {
  const markup = renderToStaticMarkup(
    <TopBar>
      <WorkspaceSwitcher {...words} workspaces={workspaces} currentId="w1" />
      <TopBarEnd>
        <span>end</span>
      </TopBarEnd>
    </TopBar>,
  );

  it('is the page’s header, with a line under it', () => {
    expect(markup).toMatch(/^<header\b[^>]*data-slot="top-bar"/);
    expect(/class="([^"]*)"/.exec(markup)?.[1]?.split(' ')).toContain('border-b');
  });

  it('pushes what is at its end (search, create, the bell, the avatar) to the far side', () => {
    expect(markup).toMatch(/<div[^>]*data-slot="top-bar-end"[^>]*class="[^"]*\bml-auto\b/);
  });
});

describe('top-bar.tsx', () => {
  const source = readFileSync(new URL('top-bar.tsx', import.meta.url), 'utf8');

  it('writes no interface text: no words between tags, none in a label, title or alt', () => {
    // Comments aside, a `>` that closes a tag (not an arrow or a generic) followed by letters and a `<`.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/(?<![=-])>\s*[A-Za-z][^<>{}=;()]*</);
    // (An empty `alt=""` marks a picture as decoration; it is no text.)
    expect(source).not.toMatch(/\b(?:aria-label|title|alt|placeholder)="[^"]/);
  });

  it('holds no colour of its own: no inline style and no raw colour value (Iris F1, round 3)', () => {
    expect(source).not.toMatch(/\bstyle=/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('draws its icons from Lucide, and no other set', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
    expect(imports.filter((from) => /icon|svg/i.test(from) && from !== 'lucide-react')).toEqual([]);
    expect(source).toContain("from 'lucide-react'");
  });
});

describe('the words the top bar’s stories name', () => {
  // The stories write each of their words in a `// en.json: <key>` comment; the app takes them from en.json, so each
  // key must be there, with the stories' wording (Iris F2 on #221).
  const messages: unknown = JSON.parse(
    readFileSync(new URL('../../../../apps/web/messages/en.json', import.meta.url), 'utf8'),
  );
  const at = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        messages,
      );

  it.each([
    ['frame.switcher.menuLabel', 'Workspaces'],
    ['frame.switcher.current', 'current'],
    [
      'frame.switcher.note',
      'Each workspace is separate: brands, posts and notifications never mix.',
    ],
    [
      'frame.switcher.loadError',
      'Couldn’t load your workspaces. Check your connection and try again.',
    ],
    ['frame.switcher.retry', 'Try again'],
    ['frame.switcher.loading', 'Loading workspaces…'],
    ['frame.account.label', 'Nadia Karim (Admin)'],
  ])('has %s in en.json, as the stories word it', (key, wording) => {
    expect(at(key)).toBe(wording);
  });

  it('has every key the stories name', () => {
    const stories = readFileSync(new URL('top-bar.stories.tsx', import.meta.url), 'utf8');
    const named = [...stories.matchAll(/en\.json: (frame\.[\w.]+)/g)].map((m) => m[1] ?? '');
    expect(named).toHaveLength(7);
    for (const key of named) expect(typeof at(key), key).toBe('string');
  });
});
