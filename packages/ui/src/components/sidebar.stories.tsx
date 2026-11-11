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
} from '@lzp/ui/components/sidebar';

// §04's left sidebar (Inbox, Calendar, Brands with pinned brands, Settings), as the v1 mockup draws it on desktop: 228
// px wide (DESIGN.md) and always open (Zeus, #205, 2026-11-11). Shown with Inbox as the current page, an item hovered
// and focused, loading, and with no pinned brands. Every name a screen reader hears comes from the caller. The top
// bar, the usage meter and the narrow-screen row of links come with #75 and their features.
const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const brands = ['Golpo Café', 'Nodi Tea House'];

function Frame({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider className="h-120 min-h-0 w-200">
      <Sidebar>
        <SidebarHeader>
          <span className="truncate px-2 font-(weight:--font-weight-h3)">Picasso Studio</span>
        </SidebarHeader>
        <SidebarContent>{children}</SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <SettingsIcon aria-hidden="true" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset />
    </SidebarProvider>
  );
}

/** Inbox and Calendar; `inboxActive` marks Inbox as the current page. */
function Pages({ inboxActive = true }: { inboxActive?: boolean }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={inboxActive}
              aria-current={inboxActive ? 'page' : undefined}
            >
              <InboxIcon aria-hidden="true" />
              <span>Inbox</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>3</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <CalendarIcon aria-hidden="true" />
              <span>Calendar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function Brands({ pinned }: { pinned: string[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Brands</SidebarGroupLabel>
      <SidebarGroupAction aria-label="Pin a brand">
        <PlusIcon aria-hidden="true" />
      </SidebarGroupAction>
      <SidebarGroupContent>
        {pinned.length === 0 ? (
          <p className="px-2 text-meta text-muted-foreground">Pin a brand to keep it here.</p>
        ) : (
          <SidebarMenu>
            {pinned.map((brand) => (
              <SidebarMenuItem key={brand}>
                <SidebarMenuButton>
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

/** Default: Inbox is the current page with 3 waiting; two pinned brands. */
export const Expanded: Story = {
  render: () => (
    <Frame>
      <Pages />
      <Brands pinned={brands} />
    </Frame>
  ),
};

/** Hover and focus act on the first item, so here it isn't the current page: the state shows on its own. */
function NotCurrent() {
  return (
    <Frame>
      <Pages inboxActive={false} />
      <Brands pinned={brands} />
    </Frame>
  );
}

export const ItemHover: Story = {
  tags: ['hover'],
  render: () => <NotCurrent />,
};

export const ItemFocus: Story = {
  tags: ['focus'],
  render: () => <NotCurrent />,
};

/** Loading: the brands on their way. */
export const Loading: Story = {
  render: () => (
    <Frame>
      <Pages />
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
    </Frame>
  ),
};

/** Empty: no pinned brands yet. */
export const NoPinnedBrands: Story = {
  render: () => (
    <Frame>
      <Pages />
      <Brands pinned={[]} />
    </Frame>
  ),
};
