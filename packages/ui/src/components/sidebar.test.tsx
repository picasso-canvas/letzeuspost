import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider, useSidebar } from '@lzp/ui/components/sidebar';

// §16: essential cookies only. The registry's sidebar wrote a `sidebar_state` cookie on every toggle; ours writes
// none and reports open and closed through `onOpenChange`, so the app chooses how to remember it (#205).

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

/** Renders a provider and hands back its context, to call its setters as the trigger and the rail do. */
function sidebarContext(props: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  let context: ReturnType<typeof useSidebar> | undefined;
  function Capture() {
    context = useSidebar();
    return null;
  }
  renderToStaticMarkup(
    <SidebarProvider {...props}>
      <Capture />
    </SidebarProvider>,
  );
  if (context === undefined) throw new Error('no sidebar context');
  return context;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sidebar', () => {
  it('sets no cookie when it opens, closes or toggles', () => {
    const writes = stubDocument();
    const before = document.cookie;
    const sidebar = sidebarContext();
    sidebar.toggleSidebar();
    sidebar.setOpen(false);
    sidebar.setOpen(true);
    expect(writes).toEqual([]);
    expect(document.cookie).toBe(before);
  });

  it('reports open and closed through onOpenChange, for the app to remember', () => {
    stubDocument();
    const onOpenChange = vi.fn();
    const sidebar = sidebarContext({ open: true, onOpenChange });
    sidebar.toggleSidebar();
    sidebar.setOpen(true);
    expect(onOpenChange.mock.calls).toEqual([[false], [true]]);
  });
});
