'use client';

import * as React from 'react';
import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
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
  /**
   * The colour of the initials' mark: workspace data the caller passes, like a brand's own colours (not an interface
   * token). `text` must keep 4.5:1 on `background`. Without it the mark is drawn in the muted tokens.
   */
  mark?: { background: string; text: string };
}

interface WorkspaceRow {
  id: string;
  name: string;
  logo: string | undefined;
  mark: Workspace['mark'];
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
  return workspaces.map(({ id, name, role, logo, mark }) => {
    const current = !marked && id === currentId;
    marked ||= current;
    return { id, name, logo, mark, current, detail: current ? `${role} · ${currentLabel}` : role };
  });
}

/**
 * A workspace's mark, as the mockup's `.ws-btn` draws it: its logo, or its initials in the workspace's own colours
 * while there is no logo or it hasn't loaded. Decorative: the name is beside it, so a screen reader skips it.
 */
function WorkspaceMark({ name, logo, mark }: Pick<WorkspaceRow, 'name' | 'logo' | 'mark'>) {
  return (
    <Avatar aria-hidden="true" className="after:border-0">
      {logo !== undefined && <AvatarImage src={logo} alt="" />}
      <AvatarFallback
        style={
          mark === undefined ? undefined : { backgroundColor: mark.background, color: mark.text }
        }
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

interface WorkspaceSwitcherProps {
  workspaces: readonly Workspace[];
  /** The workspace being used now: the frame only exists inside one (#79 guards a person with none). */
  currentId: string;
  /** Called with the id of the workspace the person chose; not for the current one. */
  onSelect?: (id: string) => void;
  /** The menu's name: "Workspaces". */
  menuLabel: string;
  /** The word for the workspace in use, shown after its role: "current". */
  currentLabel: string;
  /** The line that closes the list: "Each workspace is separate: brands, posts and notifications never mix." */
  note?: string;
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
 * belongs to, each with their role in it and the current one marked (the mockup's `openWs`). It is Base UI's menu, so
 * the arrow keys, Home, End, type-ahead, Enter and Escape work, and focus returns to the button.
 *
 * The button is named by the text it shows (the workspace's name; the mark is decorative), and has no `aria-label` of
 * its own: a label that doesn't start with the visible text fails WCAG 2.5.3 (axe `label-content-name-mismatch`, which
 * failed the first version). `aria-haspopup` and `aria-expanded` say it opens a menu. The rows are `menuitem`s with
 * `aria-current`, not `menuitemradio`: the gallery's keyboard step waits for a focused `[role="menuitem"]`.
 */
function WorkspaceSwitcher({
  workspaces,
  currentId,
  onSelect,
  menuLabel,
  currentLabel,
  note,
  error,
  disabled = false,
  defaultOpen,
  container,
  className,
}: WorkspaceSwitcherProps) {
  const rows = workspaceRows(workspaces, currentId, currentLabel);
  const current = rows.find((row) => row.current);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        data-slot="workspace-switcher"
        disabled={disabled}
        render={
          <Button variant="ghost" size="lg" className={cn('max-w-64 gap-2 px-2', className)} />
        }
      >
        {current !== undefined && (
          <>
            <WorkspaceMark name={current.name} logo={current.logo} mark={current.mark} />
            <span className="truncate font-(weight:--font-weight-h3)">{current.name}</span>
          </>
        )}
        {error !== undefined && (
          <>
            <TriangleAlertIcon className="text-destructive" aria-hidden="true" />
            <span className="sr-only">{error.message}</span>
          </>
        )}
        <ChevronsUpDownIcon
          data-icon="inline-end"
          className="text-muted-foreground"
          aria-hidden="true"
        />
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
          <>
            <DropdownMenuGroup>
              {rows.map((row) => (
                <DropdownMenuItem
                  key={row.id}
                  aria-current={row.current ? 'true' : undefined}
                  className="h-auto items-start gap-2.5 py-2"
                  onClick={() => {
                    if (!row.current) onSelect?.(row.id);
                  }}
                >
                  {row.current ? (
                    <CheckIcon className="mt-0.5" aria-hidden="true" />
                  ) : (
                    <Building2Icon className="mt-0.5" aria-hidden="true" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{row.name}</span>
                    <span className="text-meta text-muted-foreground">{row.detail}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {/* A plain div, not a paragraph: a menu may only own items, groups and generic wrappers (axe aria-required-children). */}
            {note !== undefined && (
              <div className="px-2 pt-1.5 pb-1 text-meta text-faint">{note}</div>
            )}
          </>
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
