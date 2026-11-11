import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
const workspaces = [
  { id: 'w1', name: 'Northwind Social', role: 'Admin' },
  { id: 'w2', name: 'Kite & Co', role: 'Editor' },
  { id: 'w3', name: 'বাংলা স্টুডিও', role: 'Viewer' },
];
const words = {
  label: 'LABEL: switch workspace',
  menuLabel: 'MENU: workspaces',
  currentLabel: 'CURRENT',
  emptyLabel: 'EMPTY: no workspace',
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
    const rows = workspaceRows(
      [{ ...workspaces[0]!, logo: '/logo.svg' }, workspaces[1]!],
      'w1',
      'x',
    );
    expect(rows.map((row) => row.logo)).toEqual(['/logo.svg', undefined]);
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
  it('is a button you can Tab to and press, named by the caller, showing the current workspace', () => {
    const markup = html();
    expect(markup).toMatch(/^<button\b/);
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(`aria-label="${words.label}"`);
    expect(markup).toContain('Northwind Social');
    // Not the others, until it is opened.
    expect(markup).not.toContain('Kite');
  });

  it('shows the initials when the workspace has no logo, and the logo when it has one', () => {
    expect(html()).toContain('>NS<');
    expect(html({ workspaces: [{ ...workspaces[0]!, logo: '/logo.svg' }] })).toContain('/logo.svg');
  });

  it('can be disabled, as a native button, so no key or click opens it', () => {
    expect(html({ disabled: true })).toMatch(/^<button\b[^>]*\bdisabled=""/);
    expect(html()).not.toMatch(/^<button\b[^>]*\bdisabled=""/);
  });

  it('with no workspace, says so in the caller’s words and cannot be opened', () => {
    const markup = html({ workspaces: [], currentId: undefined });
    expect(markup).toContain(words.emptyLabel);
    expect(markup).toMatch(/^<button\b[^>]*\bdisabled=""/);
  });

  it('keeps the current workspace on show when the list could not be loaded', () => {
    const markup = html({ error: { message: 'ERR: could not load', retryLabel: 'RETRY' } });
    expect(markup).toContain('Northwind Social');
    expect(markup).toMatch(/^<button\b/);
  });

  it('holds no words of its own: every word is the caller’s or a workspace’s', () => {
    const allowed = new Set([...Object.values(words), 'NS', 'Northwind Social']);
    for (const props of [
      {},
      { disabled: true },
      { workspaces: [], currentId: undefined },
      { error: { message: 'ERR', retryLabel: 'RETRY' } },
    ]) {
      const found = wordsIn(html(props)).filter((w) => !allowed.has(w) && w !== 'ERR');
      expect(found, JSON.stringify(props)).toEqual([]);
    }
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
    expect(source).not.toMatch(/>\s*[A-Za-z][^<>{}]*</);
    expect(source).not.toMatch(/\b(?:aria-label|title|alt|placeholder)="/);
  });

  it('draws its icons from Lucide, and no other set', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
    expect(imports.filter((from) => /icon|svg/i.test(from) && from !== 'lucide-react')).toEqual([]);
    expect(source).toContain("from 'lucide-react'");
  });
});
