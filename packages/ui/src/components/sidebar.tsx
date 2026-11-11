'use client';

import * as React from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@lzp/ui/lib/utils';

import { Input } from '@lzp/ui/components/input';
import { Separator } from '@lzp/ui/components/separator';
import { Skeleton } from '@lzp/ui/components/skeleton';

// The v1 mockup's frame (Zeus, #205, 2026-11-11): on desktop a 228 px sidebar, always open, beside the content. The
// registry's collapsing (icon rail, off-canvas, the trigger, the rail and ⌘B) and its phone sheet are gone; below
// 900 px the app shows a scrolling row of links instead (#75). With nothing to open or close, there is no state to
// remember, so no cookie (§16).
// Nothing here writes a `style` attribute: the app's policy is `style-src 'self' 'nonce-…'`, with no `'unsafe-inline'`, so
// a browser blocks one written in the server HTML (#222). The width is the named utility `w-sidebar` (components.css).

/**
 * The frame: the sidebar beside the content. It sits in a container named `sidebar`, whose width the narrow row is
 * measured on (the `sidebar-narrow` variant, components.css): below 900 px the frame stacks, the sidebar above the page.
 * In the app the container is as wide as the window; in the gallery it is the box the story draws it in.
 */
function SidebarProvider({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-frame" className="@container/sidebar w-full">
      <div
        data-slot="sidebar-wrapper"
        className={cn(
          'group/sidebar-wrapper flex min-h-svh w-full sidebar-narrow:flex-col',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The mockup's `.side`: the surface tint, a hairline on its right, always open. Below 900 px it is the mockup's row of
 * links along the top (`@media (max-width: 900px)`): it scrolls sideways, and its hairline is underneath.
 */
function Sidebar({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar"
      data-sidebar="sidebar"
      className={cn(
        'flex w-sidebar shrink-0 flex-col border-r bg-secondary text-secondary-foreground sidebar-narrow:w-full sidebar-narrow:flex-row sidebar-narrow:items-center sidebar-narrow:gap-0.5 sidebar-narrow:overflow-x-auto sidebar-narrow:border-r-0 sidebar-narrow:border-b sidebar-narrow:p-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn('relative flex w-full min-w-0 flex-1 flex-col bg-background', className)}
      {...props}
    />
  );
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn('h-8 w-full bg-background shadow-none', className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn(
        'flex flex-col gap-2 p-2 sidebar-narrow:shrink-0 sidebar-narrow:py-1',
        className,
      )}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn('mx-2 w-auto bg-border', className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto sidebar-narrow:flex-none sidebar-narrow:flex-row sidebar-narrow:items-center sidebar-narrow:gap-0.5 sidebar-narrow:overflow-visible',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn(
        'relative flex w-full min-w-0 flex-col p-2 sidebar-narrow:w-auto sidebar-narrow:flex-row sidebar-narrow:p-0',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'> & React.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'flex h-8 shrink-0 items-center rounded-md px-2 text-eyebrow sidebar-narrow:hidden font-(weight:--font-weight-eyebrow) tracking-eyebrow text-faint uppercase outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-group-label',
      sidebar: 'group-label',
    },
  });
}

function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<'button'> & React.ComponentProps<'button'>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'absolute top-3 right-3 flex size-6 items-center justify-center rounded-md p-0 text-muted-foreground outline-hidden transition-transform motion-reduce:transition-none hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-group-action',
      sidebar: 'group-action',
    },
  });
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('w-full text-sm sidebar-narrow:w-auto', className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn(
        'flex w-full min-w-0 flex-col gap-1 sidebar-narrow:w-auto sidebar-narrow:flex-row sidebar-narrow:gap-0.5',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn(
        'group/menu-item relative sidebar-narrow:flex sidebar-narrow:shrink-0 sidebar-narrow:items-center',
        className,
      )}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm font-normal text-muted-foreground outline-hidden group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-has-data-[sidebar=menu-badge]/menu-item:pr-8 hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring active:bg-card active:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-card data-open:hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-sidebar-current sidebar-narrow:w-auto sidebar-narrow:whitespace-nowrap sidebar-narrow:data-active:shadow-sidebar-current-narrow [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate',
  {
    variants: {
      variant: {
        default: 'hover:bg-card hover:text-foreground',
        outline:
          'bg-background shadow-sidebar-outline hover:bg-card hover:text-foreground hover:shadow-sidebar-outline-strong',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-meta',
        lg: 'h-12 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function SidebarMenuButton({
  render,
  isActive = false,
  variant = 'default',
  size = 'default',
  className,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    isActive?: boolean;
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-button',
      sidebar: 'menu-button',
      size,
      active: isActive,
    },
  });
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    showOnHover?: boolean;
  }) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'absolute top-1 right-1 flex size-6 items-center justify-center rounded-md p-0 text-muted-foreground outline-hidden transition-transform motion-reduce:transition-none peer-hover/menu-button:text-foreground peer-data-[size=default]/menu-button:top-1 peer-data-[size=lg]/menu-button:top-3 peer-data-[size=sm]/menu-button:top-0.5 hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0',
          showOnHover &&
            'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-foreground aria-expanded:opacity-100 md:opacity-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-action',
      sidebar: 'menu-action',
    },
  });
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-meta text-faint tabular-nums select-none peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A menu row on its way. The skeleton's own `muted` is the sidebar's `secondary`, so here its shapes are `border-strong`,
 * like the mockup's placeholders on the tint (Iris F1 on #206).
 */
function SidebarMenuSkeleton({
  className,
  showIcon = false,
  width = 'md',
  ...props
}: React.ComponentProps<'div'> & {
  showIcon?: boolean;
  /** The text bar's width: `sm` 55%, `md` 70% or `lg` 80% of the row. A class, never a `style` attribute (#222). */
  width?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn('flex h-8 items-center gap-2 rounded-md px-2', className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md bg-border-strong"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className={cn(
          'h-4 flex-1 bg-border-strong',
          width === 'sm' && 'max-w-11/20',
          width === 'md' && 'max-w-7/10',
          width === 'lg' && 'max-w-4/5',
        )}
        data-sidebar="menu-skeleton-text"
      />
    </div>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        'mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-border px-2.5 py-0.5',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn('group/menu-sub-item relative', className)}
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  render,
  size = 'md',
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<'a'> &
  React.ComponentProps<'a'> & {
    size?: 'sm' | 'md';
    isActive?: boolean;
  }) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn(
          'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 font-normal text-muted-foreground outline-hidden hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring active:bg-card active:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-meta data-active:bg-card data-active:text-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-sub-button',
      sidebar: 'menu-sub-button',
      size,
      active: isActive,
    },
  });
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
};
