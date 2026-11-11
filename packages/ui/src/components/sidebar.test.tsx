import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sidebar from '@lzp/ui/components/sidebar';

// The v1 mockup's frame (Zeus, #205, 2026-11-11): a 228 px sidebar, always open. The registry's sidebar collapsed
// (an icon rail, off-canvas, a phone sheet) and wrote a `sidebar_state` cookie on every toggle; ours has nothing to
// open or close and writes no cookie (§16: essential cookies only).
const { Sidebar, SidebarContent, SidebarMenuSkeleton, SidebarProvider } = sidebar;

/** A document whose cookie jar records every write. */
function stubDocument(): string[] {
  const writes: string[] = [];
  vi.stubGlobal('document', {
    get cookie() {
      return writes.join('; ');
    },
    set cookie(value: string) {
      writes.push(value);
    },
  });
  return writes;
}

const html = (): string =>
  renderToStaticMarkup(
    <SidebarProvider>
      <Sidebar>
        <SidebarContent />
      </Sidebar>
    </SidebarProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sidebar', () => {
  it('is 228 px wide and always open, with no collapsed or phone mode', () => {
    const markup = html();
    expect(markup).toContain('--sidebar-width:228px');
    expect(markup).not.toMatch(/data-state=|data-collapsible=|data-mobile=/);
  });

  it('has no way to open or close it, and no state to remember', () => {
    for (const gone of ['SidebarTrigger', 'SidebarRail', 'useSidebar'])
      expect(Object.keys(sidebar), gone).not.toContain(gone);
  });

  it('sets no cookie', () => {
    const writes = stubDocument();
    html();
    expect(writes).toEqual([]);
  });
});

/** A theme's generated colours, as `name → #rrggbb` (dark overrides light, as on the page). */
function colours(theme: 'light' | 'dark'): Map<string, string> {
  const read = (file: string) =>
    [
      ...readFileSync(new URL(`../tokens/${file}`, import.meta.url), 'utf8').matchAll(
        /--color-([\w-]+):\s*(#[0-9a-f]{6});/gi,
      ),
    ].map((m): [string, string] => [m[1] ?? '', m[2] ?? '']);
  return new Map([...read('theme.css'), ...(theme === 'dark' ? read('dark.css') : [])]);
}

/** WCAG 2.x contrast between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

/** The colour token a `bg-<token>` class in some markup names, for the element whose data-slot is given. */
function background(markup: string, slot: string): string {
  const tag = new RegExp(`<[^>]*data-(?:slot|sidebar)="${slot}"[^>]*>`).exec(markup)?.[0] ?? '';
  const token = /class="[^"]*\bbg-([\w-]+)/.exec(tag)?.[1];
  if (token === undefined) throw new Error(`no bg- class on ${slot}`);
  return token;
}

describe('the loading sidebar (Iris F1 on #206)', () => {
  const markup = renderToStaticMarkup(
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarMenuSkeleton showIcon />
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>,
  );

  it.each(['light', 'dark'] as const)(
    'draws its skeletons in a surface that visibly differs from the sidebar (%s)',
    (theme) => {
      const tokens = colours(theme);
      const side = tokens.get(background(markup, 'sidebar'));
      for (const slot of ['menu-skeleton-icon', 'menu-skeleton-text']) {
        const skeleton = tokens.get(background(markup, slot));
        expect(skeleton, slot).toBeDefined();
        expect(skeleton, slot).not.toBe(side);
        // Like the mockup's placeholders, a shape you can see on the sidebar's tint, not an empty group.
        expect(contrast(skeleton ?? '', side ?? ''), slot).toBeGreaterThanOrEqual(1.3);
      }
    },
  );
});
