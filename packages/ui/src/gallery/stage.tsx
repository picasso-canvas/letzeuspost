'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@lzp/ui/lib/utils';

/**
 * A box in the gallery canvas that open overlays (menus, tooltips, sheets, toasts) render into through their
 * `container` prop, so the screenshot, focus and motion tests (tests/gallery) see them (#205). Its transform also makes
 * it the containing block of their fixed positioning, so a sheet or a toast sits inside the box, not the window.
 */
export function Stage({
  className,
  children,
}: {
  className?: string;
  children: (container: HTMLElement) => ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer} className={cn('relative transform-gpu', className)}>
      {container !== null && children(container)}
    </div>
  );
}
