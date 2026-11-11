import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sidebar from '@lzp/ui/components/sidebar';
import { buildCss } from '@lzp/ui/lib/build-css';

// The v1 mockup's frame (Zeus, #205, 2026-11-11): a 228 px sidebar, always open. The registry's sidebar collapsed
// (an icon rail, off-canvas, a phone sheet) and wrote a `sidebar_state` cookie on every toggle; ours has nothing to
// open or close and writes no cookie (§16: essential cookies only).
const {
  Sidebar,
  SidebarContent,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  SidebarMenuSubButton,
  SidebarProvider,
} = sidebar;

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

/** A class name as the compiled CSS writes it in a selector (`\:`, `\(`), escaped once more to be matched as text. */
const selectorPattern = (name: string): string =>
  name.replace(/[^\w-]/g, '\\$&').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * Every font weight the given classes can set on an element, resolved to a number: what the browser computes on the
 * element once all of its variants (current, hover, open) apply, with `--font-weight-*` read from the theme.
 */
async function fontWeights(classes: string[]): Promise<number[]> {
  const css = await buildCss(classes);
  const theme = (name: string): number => {
    const value = new RegExp(`--font-weight-${name}:\\s*(\\d+)`).exec(css)?.[1];
    if (value === undefined) throw new Error(`no --font-weight-${name} in the theme`);
    return Number(value);
  };
  const weights: number[] = [];
  for (const name of classes) {
    for (const rule of css.matchAll(
      new RegExp(`\\.${selectorPattern(name)}[^{]*\\{([^}]*)\\}`, 'g'),
    )) {
      for (const [, value = ''] of (rule[1] ?? '').matchAll(/(?<![\w-])font-weight:\s*([^;]+);/g)) {
        const named = /^var\(--font-weight-([\w-]+)\)$/.exec(value.trim())?.[1];
        weights.push(named === undefined ? Number(value) : theme(named));
      }
    }
  }
  return weights;
}

const classesOfFirstTag = (markup: string): string[] =>
  /class="([^"]*)"/.exec(markup)?.[1]?.split(' ') ?? [];

describe('the sidebar nav items (Zeus, #75, 2026-11-11)', () => {
  // Every item is at the body weight, 400, the current page included: it is marked only by its card and its 2 px bar.
  const items = {
    'an item': <SidebarMenuButton>Inbox</SidebarMenuButton>,
    'the current item': <SidebarMenuButton isActive>Inbox</SidebarMenuButton>,
    'a small item': <SidebarMenuButton size="sm">Inbox</SidebarMenuButton>,
    'a large item': <SidebarMenuButton size="lg">Inbox</SidebarMenuButton>,
    'an outlined item': <SidebarMenuButton variant="outline">Inbox</SidebarMenuButton>,
    'a sub item': <SidebarMenuSubButton>Inbox</SidebarMenuSubButton>,
    'the current sub item': <SidebarMenuSubButton isActive>Inbox</SidebarMenuSubButton>,
  };

  it.each(Object.entries(items))(
    'sets %s at weight 400, whatever state it is in',
    async (_, el) => {
      const weights = await fontWeights(classesOfFirstTag(renderToStaticMarkup(el)));
      // Set outright, so a heavier parent can't change it; and nothing in any variant sets another weight.
      expect(weights.length).toBeGreaterThan(0);
      expect(new Set(weights)).toEqual(new Set([400]));
    },
  );

  it('marks the current page by its card and 2 px bar, and by nothing else', () => {
    const current = classesOfFirstTag(renderToStaticMarkup(items['the current item']));
    for (const cls of ['data-active:bg-card', 'data-active:shadow-sidebar-current'])
      expect(current).toContain(cls);
    expect(current.filter((c) => c.startsWith('data-active:font'))).toEqual([]);
  });
});
