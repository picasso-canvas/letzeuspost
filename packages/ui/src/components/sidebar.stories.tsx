import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDaysIcon, InboxIcon, LayersIcon, SettingsIcon } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from '@lzp/ui/components/sidebar';
import brightwell from '../gallery/mark-brightwell.svg';
import golpo from '../gallery/mark-golpo.svg';
import ironline from '../gallery/mark-ironline.svg';

// §04's left sidebar as the v1 mockup's `.nav` draws it (screens/03-inbox-*.png): Inbox, Calendar and Brands, the
// pinned brands under their eyebrow, each with its own mark, then Settings; 228 px wide (DESIGN.md) and always open
// (Zeus, #205, 2026-11-11). Shown with Inbox as the current page, an item hovered and focused, loading, and with no
// pinned brands. The group and item actions (`SidebarGroupAction`, `SidebarMenuAction`) stay in the component for
// later screens; the mockup's nav has none. The logo and the usage meter come with their features.
const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The mockup's sample brands; a real brand's mark comes from its kit. */
const pinned = [
  { name: 'Golpo Café', mark: golpo },
  { name: 'Ironline Studio', mark: ironline },
  { name: 'Brightwell Dental', mark: brightwell },
];

/**
 * The frame in a box of the story's width: the sidebar's narrow row is measured on the box (its container), not on the
 * window, so a box under 900 px shows it. The wide stories' box is over 900 px.
 */
function Frame({
  children,
  width = 'w-240',
  height = 'h-120',
}: {
  children: ReactNode;
  width?: string;
  height?: string;
}) {
  return (
    <div className={width}>
      <SidebarProvider className={`${height} min-h-0`}>
        <Sidebar>
          <SidebarHeader>
            <span className="truncate px-2 text-h2 font-(weight:--font-weight-h2) tracking-h2">
              LetZeusPost
            </span>
          </SidebarHeader>
          <SidebarContent>
            {children}
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <SettingsIcon aria-hidden="true" />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset />
      </SidebarProvider>
    </div>
  );
}

/** Inbox, Calendar and Brands; `inboxCurrent` marks Inbox as the current page. */
function Pages({ inboxCurrent = true }: { inboxCurrent?: boolean }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={inboxCurrent}
              aria-current={inboxCurrent ? 'page' : undefined}
            >
              <InboxIcon aria-hidden="true" />
              <span>Inbox</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>9</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <CalendarDaysIcon aria-hidden="true" />
              <span>Calendar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <LayersIcon aria-hidden="true" />
              <span>Brands</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function PinnedBrands({ brands }: { brands: typeof pinned }) {
  return (
    <SidebarGroup className="sidebar-narrow:hidden">
      <SidebarGroupLabel>Pinned brands</SidebarGroupLabel>
      <SidebarGroupContent>
        {brands.length === 0 ? (
          <p className="px-2 text-meta text-muted-foreground">Pin a brand to keep it here.</p>
        ) : (
          <SidebarMenu>
            {brands.map(({ name, mark }) => (
              <SidebarMenuItem key={name}>
                <SidebarMenuButton>
                  <img src={mark} alt="" className="size-4 shrink-0" />
                  <span>{name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Default: Inbox is the current page with 9 waiting; three pinned brands. */
export const Expanded: Story = {
  render: () => (
    <Frame>
      <Pages />
      <PinnedBrands brands={pinned} />
    </Frame>
  ),
};

/** Hover and focus act on the first item, so here it isn't the current page: the state shows on its own. */
function NotCurrent() {
  return (
    <Frame>
      <Pages inboxCurrent={false} />
      <PinnedBrands brands={pinned} />
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

/** Loading: the pinned brands on their way. */
export const Loading: Story = {
  render: () => (
    <Frame>
      <Pages />
      <SidebarGroup aria-busy="true" className="sidebar-narrow:hidden">
        <SidebarGroupLabel>Pinned brands</SidebarGroupLabel>
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
      <PinnedBrands brands={[]} />
    </Frame>
  ),
};

/**
 * Below 900 px (the mockup's `@media (max-width: 900px)`): the sidebar is a row of links along the top that scrolls
 * sideways, the current page marked by its card and a 2 px bar under it; the group labels and the pinned brands drop
 * out. The frame is drawn in a 384 px box, because the row is measured on the frame, not on the window.
 */
export const NarrowRow: Story = {
  render: () => (
    <Frame width="w-96" height="h-48">
      <Pages />
      <PinnedBrands brands={pinned} />
    </Frame>
  ),
};
