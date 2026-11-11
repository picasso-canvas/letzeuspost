'use client';

import * as React from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { cn } from '@lzp/ui/lib/utils';

import { Button } from '@lzp/ui/components/button';
import {
  XIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const toast = ToastPrimitive.createToastManager();

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        'pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full',
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        'group/toast pointer-events-auto absolute right-0 bottom-0 z-toast w-full origin-bottom rounded-lg border bg-popover text-popover-foreground shadow-frame will-change-transform outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring',
        'toast-vars',
        'h-(--height) toast-stack toast-transition',
        'after:absolute after:top-full after:left-0 after:h-toast-gap after:w-full',
        'data-expanded:h-(--toast-height) data-expanded:toast-expanded',
        'data-limited:opacity-0 data-starting-style:toast-out',
        '[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:toast-out',
        'data-ending-style:data-[swipe-direction=down]:toast-swipe-down',
        'data-ending-style:data-[swipe-direction=left]:toast-swipe-left',
        'data-ending-style:data-[swipe-direction=right]:toast-swipe-right',
        'data-ending-style:data-[swipe-direction=up]:toast-swipe-up',
        'data-expanded:data-ending-style:data-[swipe-direction=down]:toast-swipe-down',
        'data-expanded:data-ending-style:data-[swipe-direction=left]:toast-swipe-left',
        'data-expanded:data-ending-style:data-[swipe-direction=right]:toast-swipe-right',
        'data-expanded:data-ending-style:data-[swipe-direction=up]:toast-swipe-up',
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        'flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity motion-reduce:transition-none data-behind:opacity-0 data-expanded:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn('text-sm font-(weight:--font-weight-h3)', className)}
      {...props}
    />
  );
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="secondary" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}

/** `label` is the button's accessible name, from the caller (§21: interface text lives in the app's messages). */
function ToastClose({
  className,
  children,
  label,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props & { label: string }) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label={label}
      render={render}
      className={cn(
        'relative shrink-0 text-muted-foreground after:absolute after:-inset-2 hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null;

  if (type === 'success') {
    icon = <CircleCheckIcon aria-hidden="true" />;
  }

  if (type === 'info') {
    icon = <InfoIcon aria-hidden="true" />;
  }

  if (type === 'warning') {
    icon = <TriangleAlertIcon aria-hidden="true" />;
  }

  if (type === 'error') {
    icon = <OctagonXIcon className="text-destructive" aria-hidden="true" />;
  }

  if (type === 'loading') {
    icon = <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  }

  if (!icon) {
    return null;
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose label={closeLabel} />
      </ToastContent>
    </Toast>
  ));
}

/** `closeLabel` names each toast's close button; `container` is where the toasts render (the body by default). */
function Toaster({
  children,
  toastManager = toast,
  closeLabel,
  container,
  ...props
}: ToastPrimitive.Provider.Props & { closeLabel: string } & Pick<
    ToastPrimitive.Portal.Props,
    'container'
  >) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal container={container}>
        <ToastViewport>
          <ToastList closeLabel={closeLabel} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
