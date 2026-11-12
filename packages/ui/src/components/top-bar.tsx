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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@lzp/ui/components/dropdown-menu';
import { Skeleton } from '@lzp/ui/components/skeleton';

/** `bn` for a name written in Bangla, so it gets its font, its shaping and the right voice (Zeus, 2026-11-11). */
export function langOf(name: string): 'bn' | undefined {
  return /\p{Script=Bengali}/u.test(name) ? 'bn' : undefined;
}

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
  /**
   * The workspace's logo (§15), a URL. A workspace has no colour of its own (Zeus, #75, 2026-11-11): without a logo,
   * or until it has loaded, its initials are drawn on the muted tokens.
   */
  logo?: string;
}

interface WorkspaceRow extends Workspace {
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
  return workspaces.map((workspace) => {
    const current = !marked && workspace.id === currentId;
    marked ||= current;
    const detail = current ? `${workspace.role} · ${currentLabel}` : workspace.role;
    return { ...workspace, current, detail };
  });
}

/**
 * A workspace's mark, as the mockup's `.ws-btn` draws it: its logo, or its initials on the muted token surface while
 * there is no logo or it hasn't loaded (Zeus, #75, 2026-11-11). Decorative: the name is beside it, so the logo's `alt`
 * is empty and a screen reader skips the mark.
 */
function WorkspaceMark({ name, logo }: Pick<Workspace, 'name' | 'logo'>) {
  return (
    <Avatar aria-hidden="true" className="after:border-0">
      {logo !== undefined && <AvatarImage src={logo} alt="" />}
      <AvatarFallback>{initialsOf(name)}</AvatarFallback>
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
 * failed the first version). `aria-haspopup` and `aria-expanded` say it opens a menu. The rows are `menuitemradio`s
 * with `aria-checked` on the current one, as the mockup's `openWs` has them; choosing one closes the menu.
 *
 * A name too long for the button is cut with an ellipsis there (one line is all the bar has room for), but it wraps in
 * its row in the open menu, so two workspaces whose names start alike can still be told apart (Iris F1 on the App
 * shell batch).
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
            <WorkspaceMark name={current.name} logo={current.logo} />
            <span className="truncate font-(weight:--font-weight-h3)" lang={langOf(current.name)}>
              {current.name}
            </span>
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
            {/* The mockup's `menuitemradio` rows: Base UI gives each its role and `aria-checked`. */}
            <DropdownMenuRadioGroup
              value={current?.id ?? null}
              onValueChange={(id: unknown) => {
                if (typeof id === 'string' && id !== current?.id) onSelect?.(id);
              }}
            >
              {rows.map((row) => (
                <DropdownMenuRadioItem
                  key={row.id}
                  value={row.id}
                  closeOnClick
                  className="h-auto items-start gap-2.5 py-2 pr-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                >
                  {row.current ? (
                    <CheckIcon className="mt-0.5" aria-hidden="true" />
                  ) : (
                    <Building2Icon className="mt-0.5" aria-hidden="true" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="wrap-break-word" lang={langOf(row.name)}>
                      {row.name}
                    </span>
                    <span className="text-meta text-muted-foreground">{row.detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
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
