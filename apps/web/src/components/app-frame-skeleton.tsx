import { Empty, EmptyHeader } from '@lzp/ui/components/empty';
import { LogoMark } from '@lzp/ui/components/logo-mark';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from '@lzp/ui/components/sidebar';
import { Skeleton } from '@lzp/ui/components/skeleton';
import { TopBar, TopBarEnd, WorkspaceSwitcherSkeleton } from '@lzp/ui/components/top-bar';
import { messages } from '../messages.ts';

const { frame, inbox } = messages;

/**
 * The Inbox while it loads (§04: "Loading: skeletons"): its heading and line as they will be, and the empty state's one
 * box (page.tsx's, the same classes) with its two lines drawn as the gallery's skeletons, so nothing moves when the page
 * arrives. Each skeleton holds the words it stands for, invisible and hidden from a screen reader, so it is as tall as
 * those words wrap at any width, the phone's included. A screen reader hears that it is loading; nothing of the
 * workspace is in it.
 */
export function InboxSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-(weight:--font-weight-h1) tracking-h1 text-balance">
          {inbox.heading}
        </h1>
        <p className="text-pretty text-muted-foreground">{inbox.intro}</p>
      </div>
      <Empty role="status" aria-busy="true" className="border">
        <span className="sr-only">{inbox.loading}</span>
        <EmptyHeader>
          <Skeleton
            aria-hidden="true"
            className="text-h2 font-(weight:--font-weight-h2) tracking-h2"
          >
            <span className="invisible">{inbox.empty.heading}</span>
          </Skeleton>
          <Skeleton aria-hidden="true" className="text-sm/relaxed">
            <span className="invisible">{inbox.empty.body}</span>
          </Skeleton>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

/**
 * The signed-in frame while the guard opens the workspace (Iris F4 on #79): `AppFrame`'s layout, with the gallery's
 * skeletons where the person's things will be: the sidebar's pages, the workspace switcher and the avatar. It is drawn
 * before the guard has answered, so it holds nothing of a person or a workspace, only the app's own words.
 */
export function AppFrameSkeleton() {
  return (
    <SidebarProvider>
      <Sidebar>
        <nav
          aria-label={frame.nav.label}
          aria-busy="true"
          className="flex min-h-0 flex-1 flex-col sidebar-narrow:flex-row sidebar-narrow:items-center sidebar-narrow:gap-0.5"
        >
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <LogoMark />
              <span className="truncate text-h3 font-(weight:--font-weight-h3) text-foreground">
                {messages.app.name}
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon width="sm" />
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </nav>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar>
          <WorkspaceSwitcherSkeleton label={frame.switcher.loading} />
          <TopBarEnd>
            <Skeleton className="size-8 rounded-full" />
          </TopBarEnd>
        </TopBar>
        <SidebarInset>
          <InboxSkeleton />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
