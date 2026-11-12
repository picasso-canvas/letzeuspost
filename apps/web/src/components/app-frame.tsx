import Link from 'next/link';
import type { ReactNode } from 'react';
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
  SidebarProvider,
} from '@lzp/ui/components/sidebar';
import { TopBar, TopBarEnd, type Workspace } from '@lzp/ui/components/top-bar';
import { INBOX } from '../app/app/workspace.ts';
import { messages } from '../messages.ts';
import { AccountMenu } from './account-menu.tsx';
import { NavLink } from './nav-link.tsx';
import { SwitchWorkspace } from './switch-workspace.tsx';

const { frame } = messages;

export interface AppFrameProps {
  /** The signed-in person's name, for the avatar and its menu. Nothing else of theirs reaches the browser. */
  person: { name: string };
  /** The workspace in use, with the person's role in it, in en.json's words ("Owner"). */
  current: { id: string; role: string };
  /** Every workspace the person belongs to, with their role in each, for the switcher. */
  workspaces: readonly Workspace[];
  children: ReactNode;
}

/**
 * The frame of every signed-in page (§04, the v1 mockup's 03-inbox): the sidebar, always open, with the logo and the
 * pages; beside it the top bar (the workspace switcher at the start, the avatar menu at the end) over the page. The
 * sidebar's other pages (Calendar, Brands, Settings) and the top bar's search, + Create and bell come with their
 * features. The logo is the Inbox's link, inside the navigation landmark with the pages, so every part of the frame
 * sits in a landmark.
 */
export function AppFrame({ person, current, workspaces, children }: AppFrameProps) {
  return (
    <SidebarProvider>
      <Sidebar>
        <nav
          aria-label={frame.nav.label}
          className="flex min-h-0 flex-1 flex-col sidebar-narrow:flex-row sidebar-narrow:items-center sidebar-narrow:gap-0.5"
        >
          <SidebarHeader>
            <Link
              href={INBOX}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
            >
              <LogoMark />
              <span className="truncate text-h3 font-(weight:--font-weight-h3) text-foreground">
                {messages.app.name}
              </span>
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <NavLink href={INBOX} label={frame.nav.inbox} />
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </nav>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar>
          <SwitchWorkspace workspaces={workspaces} currentId={current.id} />
          <TopBarEnd>
            <AccountMenu name={person.name} role={current.role} />
          </TopBarEnd>
        </TopBar>
        <SidebarInset>{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}
