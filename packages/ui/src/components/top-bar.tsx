'use client';

import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { cn } from '@lzp/ui/lib/utils';
import { initialsOf } from '@lzp/ui/lib/initials';

import { Avatar, AvatarFallback, AvatarImage } from '@lzp/ui/components/avatar';
import { Button } from '@lzp/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@lzp/ui/components/dropdown-menu';
import { Skeleton } from '@lzp/ui/components/skeleton';

// §04's top bar, as the v1 mockup's `.top` draws it: the workspace's name and switcher at the start, and at the end what
// belongs to the person (search, + Create, the bell and the avatar come with their features). §15: "a switcher in the top
// bar lists the workspaces a person belongs to, with their role in each". These components write no words: every label,
// role and message comes from the caller (§21: all interface text lives in apps/web/messages/en.json).

/** The top bar: a header with a line under it, that wraps on a narrow screen. */
function TopBar({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="top-bar"
      className={cn('flex min-h-14 flex-wrap items-center gap-2.5 border-b px-4 py-2', className)}
      {...props}
    />
  );
}

/** What sits at the far end of the top bar, after the switcher. */
function TopBarEnd({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="top-bar-end"
      className={cn('ml-auto flex items-center gap-2.5', className)}
      {...props}
    />
  );
}

/** A workspace the person belongs to; `role` is their role in it, as the caller words it ("Admin"). */
interface Workspace {
  id: string;
  name: string;
  role: string;
  /** The workspace's logo; without one, its initials are drawn. */
  logo?: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  logo: string | undefined;
  /** The role, then the caller's word for "current" on the current workspace: "Admin · current". */
  detail: string;
  current: boolean;
}

/** The menu's rows, in the order given: each with its role, and the current workspace marked, once at most. */
function workspaceRows(
  workspaces: readonly Workspace[],
  currentId: string | undefined,
  currentLabel: string,
): WorkspaceRow[] {
  let marked = false;
  return workspaces.map(({ id, name, role, logo }) => {
    const current = !marked && id === currentId;
    marked ||= current;
    return { id, name, logo, current, detail: current ? `${role} · ${currentLabel}` : role };
  });
}

/** A workspace's mark: its logo, or its initials while there is none or it hasn't loaded. Decorative: the name is beside it. */
function WorkspaceMark({
  name,
  logo,
  size,
}: {
  name: string;
  logo?: string;
  size?: 'sm' | 'default' | 'lg';
}) {
  return (
    <Avatar size={size} aria-hidden="true">
      {logo !== undefined && <AvatarImage src={logo} alt="" />}
      <AvatarFallback>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

interface WorkspaceSwitcherProps {
  workspaces: readonly Workspace[];
  /** The workspace being used now. */
  currentId?: string;
  /** Called with the id of the workspace the person chose; not for the current one. */
  onSelect?: (id: string) => void;
  /** The button's name for a screen reader: "Workspace: Northwind Social. Switch workspace". */
  label: string;
  /** The menu's name: "Workspaces". */
  menuLabel: string;
  /** The word for the workspace in use, shown after its role: "current". */
  currentLabel: string;
  /** Shown on the button when there is no current workspace to name: "No workspace yet". With no workspaces at all it can't be opened. */
  emptyLabel: string;
  /** The list couldn't be loaded: the menu says why, with a way to try again. */
  error?: { message: string; retryLabel: string; onRetry?: () => void };
  disabled?: boolean;
  /** Start with the menu open (the gallery's open state). */
  defaultOpen?: boolean;
  /** Where the open menu is drawn, for the gallery; the page's body when left out. */
  container?: HTMLElement | null;
  className?: string;
}

/**
 * The workspace switcher: the current workspace's name on a button that opens a menu of every workspace the person
 * belongs to, each with their role in it and the current one marked. It is Base UI's menu, so the arrow keys, Home, End,
 * type-ahead, Enter and Escape work, and focus returns to the button.
 */
function WorkspaceSwitcher({
  workspaces,
  currentId,
  onSelect,
  label,
  menuLabel,
  currentLabel,
  emptyLabel,
  error,
  disabled = false,
  defaultOpen,
  container,
  className,
}: WorkspaceSwitcherProps) {
  const rows = workspaceRows(workspaces, currentId, currentLabel);
  const current = rows.find((row) => row.current);
  const empty = rows.length === 0;
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        data-slot="workspace-switcher"
        aria-label={label}
        disabled={disabled || empty}
        render={
          <Button variant="ghost" size="lg" className={cn('max-w-64 gap-2 px-2', className)} />
        }
      >
        {current === undefined ? (
          <span className="truncate text-muted-foreground">{emptyLabel}</span>
        ) : (
          <>
            <WorkspaceMark name={current.name} logo={current.logo} />
            <span className="truncate">{current.name}</span>
          </>
        )}
        {error !== undefined && (
          <TriangleAlertIcon className="text-destructive" aria-hidden="true" />
        )}
        {!empty && (
          <ChevronsUpDownIcon
            data-icon="inline-end"
            className="text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent container={container} aria-label={menuLabel} className="w-64">
        {error !== undefined ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-start gap-2 text-foreground">
              <TriangleAlertIcon className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
              {error.message}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => error.onRetry?.()}>
              <RotateCcwIcon aria-hidden="true" />
              {error.retryLabel}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuGroup>
            {rows.map((row) => (
              <DropdownMenuItem
                key={row.id}
                aria-current={row.current ? 'true' : undefined}
                className="h-auto gap-2 py-2"
                onClick={() => {
                  if (!row.current) onSelect?.(row.id);
                }}
              >
                <WorkspaceMark name={row.name} logo={row.logo} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{row.name}</span>
                  <span className="text-meta text-muted-foreground">{row.detail}</span>
                </span>
                {row.current && <CheckIcon aria-hidden="true" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The switcher on its way: the shape of its mark and name; `label` ("Loading workspaces…") is for a screen reader. */
function WorkspaceSwitcherSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div
      data-slot="workspace-switcher-skeleton"
      role="status"
      aria-busy="true"
      className={cn('flex h-10 items-center gap-2 px-2', className)}
    >
      <Skeleton className="size-8 rounded-full" />
      <Skeleton className="h-4 w-32" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export { TopBar, TopBarEnd, WorkspaceSwitcher, WorkspaceSwitcherSkeleton, workspaceRows };
export type { Workspace, WorkspaceRow, WorkspaceSwitcherProps };
