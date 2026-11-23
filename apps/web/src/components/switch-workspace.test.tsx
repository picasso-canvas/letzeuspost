// The switcher's workspace mark (Iris F2 on #79, #254): the v1 mockup's 03-inbox draws it as a filled navy disc with
// white initials, not the pale muted avatar. DESIGN.md's `workspace-mark` token pair holds those colours, the same in
// both themes: `workspace-mark` for the fill, `workspace-mark-foreground` for the initials, and no raw value.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildCss } from '@lzp/ui/lib/build-css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('../app/app/actions.ts', () => ({ switchWorkspace: () => Promise.resolve({ ok: true }) }));

const { SwitchWorkspace } = await import('./switch-workspace.tsx');

const NORTHWIND = { id: '0190a6b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b', name: 'Northwind Social' };

/** The rule that starts at `opener` in `css`: its selector and its first `{ … }` block, braces balanced. */
function rule(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`no ${opener} in the CSS`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${opener}`);
}

/** The classes in a `class="…"` attribute's value, as written in the source (the markup escapes `&` as `&amp;`). */
const classesIn = (value: string) => value.replaceAll('&amp;', '&').split(' ');

describe('the workspace mark in the switcher', () => {
  const html = renderToStaticMarkup(
    <SwitchWorkspace workspaces={[{ ...NORTHWIND, role: 'Owner' }]} currentId={NORTHWIND.id} />,
  );
  /** The switcher button's opening tag and its classes. */
  const button = /<button[^>]*data-slot="workspace-switcher"[^>]*>/.exec(html)?.[0] ?? '';
  const buttonClasses = classesIn(/class="([^"]*)"/.exec(button)?.[1] ?? '');

  it('shows the workspace’s initials in the mark, beside its name', () => {
    expect(button).not.toBe('');
    expect(html).toMatch(/data-slot="avatar-fallback"[^>]*>NS</);
    expect(html).toContain('>Northwind Social<');
  });

  it('fills the mark with the workspace-mark token and writes its initials in its foreground token, in both themes', async () => {
    const candidates = html.match(/class="([^"]*)"/g)?.flatMap((m) => classesIn(m.slice(7, -1)));
    const css = await buildCss(candidates ?? []);
    // The rules the switcher's own classes give the mark's initials (the avatar fallback inside the button).
    const mark = buttonClasses.filter((c) => c.includes('data-slot=avatar-fallback'));
    expect(mark.length).toBeGreaterThan(0);
    const rules = mark.map((c) =>
      rule(
        css,
        c.replace(/[[\]&=:]/g, (ch) => `\\${ch}`),
      ),
    );
    const declarations = rules.join('\n');
    expect(declarations).toContain('[data-slot=avatar-fallback]');
    expect(declarations).toMatch(/background-color:\s*var\(--color-workspace-mark\)/);
    expect(declarations).toMatch(/(?<![-\w])color:\s*var\(--color-workspace-mark-foreground\)/);
    // Nothing of the ink pair it used before (round 5 of #79) is left on the mark.
    expect(declarations).not.toMatch(/var\(--color-(foreground|background)\)/);
    // A token, never a raw value: the same classes serve light and dark, as the tokens change with the theme.
    expect(declarations).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
    expect(mark.some((c) => c.startsWith('dark:'))).toBe(false);
  });
});
