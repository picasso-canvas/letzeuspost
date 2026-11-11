import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CalendarIcon,
  EllipsisIcon,
  InboxIcon,
  PlusIcon,
  SettingsIcon,
  StoreIcon,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
} from '@lzp/ui/components/sidebar';
import { Stage } from '../gallery/stage';

// §04's left sidebar (Inbox, Calendar, Brands with pinned brands, Settings), 228 px wide (DESIGN.md), in a Stage
// inside the canvas: expanded with Inbox active, an item hovered and focused, collapsed to icons, loading, and with no
// pinned brands. Every name a screen reader hears comes from the caller. The top bar and the usage meter come with
// #75 and their features.
const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const brands = ['Golpo Café', 'Nodi Tea House'];

function Frame({
  collapsed = false,
  children,
}: {
  collapsed?: boolean;
  children: (container: HTMLElement) => ReactNode;
}) {
  return (
    <Stage className="h-120 w-200">
      {(container) => (
        <SidebarProvider defaultOpen={!collapsed} className="h-full min-h-0">
          <Sidebar collapsible="icon" mobileTitle="Navigation" className="h-auto">
            <SidebarHeader>
              <span className="truncate px-2 font-(weight:--font-weight-h3) group-data-[collapsible=icon]:hidden">
                Picasso Studio
              </span>
            </SidebarHeader>
            <SidebarContent>{children(container)}</SidebarContent>
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip={{ children: 'Settings', container }}>
                    <SettingsIcon aria-hidden="true" />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset className="p-4">
            <SidebarTrigger label="Show or hide the sidebar" />
          </SidebarInset>
        </SidebarProvider>
      )}
    </Stage>
  );
}

/** Inbox and Calendar; `inboxActive` marks Inbox as the current page. */
function Pages({
  container,
  inboxActive = true,
}: {
  container: HTMLElement;
  inboxActive?: boolean;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={inboxActive} tooltip={{ children: 'Inbox', container }}>
              <InboxIcon aria-hidden="true" />
              <span>Inbox</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>3</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={{ children: 'Calendar', container }}>
              <CalendarIcon aria-hidden="true" />
              <span>Calendar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function Brands({ container, pinned }: { container: HTMLElement; pinned: string[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Brands</SidebarGroupLabel>
      <SidebarGroupAction aria-label="Pin a brand">
        <PlusIcon aria-hidden="true" />
      </SidebarGroupAction>
      <SidebarGroupContent>
        {pinned.length === 0 ? (
          <p className="px-2 text-meta text-muted-foreground group-data-[collapsible=icon]:hidden">
            Pin a brand to keep it here.
          </p>
        ) : (
          <SidebarMenu>
            {pinned.map((brand) => (
              <SidebarMenuItem key={brand}>
                <SidebarMenuButton tooltip={{ children: brand, container }}>
                  <StoreIcon aria-hidden="true" />
                  <span>{brand}</span>
                </SidebarMenuButton>
                <SidebarMenuAction aria-label={`More for ${brand}`}>
                  <EllipsisIcon aria-hidden="true" />
                </SidebarMenuAction>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Default: expanded, Inbox active with 3 waiting, two pinned brands. */
export const Expanded: Story = {
  args: { mobileTitle: 'Navigation' },
  render: () => (
    <Frame>
      {(container) => (
        <>
          <Pages container={container} />
          <Brands container={container} pinned={brands} />
        </>
      )}
    </Frame>
  ),
};

/** Hover and focus act on the first item, so here it isn't the current page: the state shows on its own. */
function NotCurrent() {
  return (
    <Frame>
      {(container) => (
        <>
          <Pages container={container} inboxActive={false} />
          <Brands container={container} pinned={brands} />
        </>
      )}
    </Frame>
  );
}

export const ItemHover: Story = {
  args: { mobileTitle: 'Navigation' },
  tags: ['hover'],
  render: () => <NotCurrent />,
};

export const ItemFocus: Story = {
  args: { mobileTitle: 'Navigation' },
  tags: ['focus'],
  render: () => <NotCurrent />,
};

/** Collapsed to icons; each item's name shows as a tooltip on hover or focus. */
export const Collapsed: Story = {
  args: { mobileTitle: 'Navigation' },
  render: () => (
    <Frame collapsed>
      {(container) => (
        <>
          <Pages container={container} />
          <Brands container={container} pinned={brands} />
        </>
      )}
    </Frame>
  ),
};

/** Loading: the brands on their way. */
export const Loading: Story = {
  args: { mobileTitle: 'Navigation' },
  render: () => (
    <Frame>
      {(container) => (
        <>
          <Pages container={container} />
          <SidebarGroup aria-busy="true">
            <SidebarGroupLabel>Brands</SidebarGroupLabel>
            <SidebarMenu>
              {['70%', '55%', '80%'].map((width) => (
                <SidebarMenuItem key={width}>
                  <SidebarMenuSkeleton showIcon width={width} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </>
      )}
    </Frame>
  ),
};

/** Empty: no pinned brands yet. */
export const NoPinnedBrands: Story = {
  args: { mobileTitle: 'Navigation' },
  render: () => (
    <Frame>
      {(container) => (
        <>
          <Pages container={container} />
          <Brands container={container} pinned={[]} />
        </>
      )}
    </Frame>
  ),
};
