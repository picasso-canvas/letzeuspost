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

/** The list's rows on their way: each a thumbnail, a title and a line, and the action at the end, at varied widths. */
const ROWS = [
  { title: 'w-1/3', line: 'w-1/2' },
  { title: 'w-1/4', line: 'w-2/5' },
  { title: 'w-2/5', line: 'w-1/3' },
] as const;

/**
 * The Inbox while it loads (§04: "Loading: skeletons"): its heading and line as they will be, and the list drawn as the
 * gallery's skeletons. A screen reader hears that it is loading; nothing of the workspace is in it.
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
      <div role="status" aria-busy="true" className="flex flex-col rounded-lg border">
        <span className="sr-only">{inbox.loading}</span>
        {ROWS.map(({ title, line }) => (
          <div
            key={`${title} ${line}`}
            className="flex items-center gap-4 border-b p-4 last:border-b-0"
          >
            <Skeleton className="size-12 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className={`h-4 ${title}`} />
              <Skeleton className={`h-3 ${line}`} />
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        ))}
      </div>
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
