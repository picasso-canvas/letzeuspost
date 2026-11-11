import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sidebar from '@lzp/ui/components/sidebar';

// The v1 mockup's frame (Zeus, #205, 2026-11-11): a 228 px sidebar, always open. The registry's sidebar collapsed
// (an icon rail, off-canvas, a phone sheet) and wrote a `sidebar_state` cookie on every toggle; ours has nothing to
// open or close and writes no cookie (§16: essential cookies only).
const { Sidebar, SidebarContent, SidebarProvider } = sidebar;

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
