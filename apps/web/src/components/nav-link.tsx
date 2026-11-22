'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SidebarMenuButton } from '@lzp/ui/components/sidebar';

/**
 * A sidebar link that marks itself as the current page (`aria-current`, and the sidebar's current style) on its path.
 * Its `icon` (an element from `@lzp/ui/components/icons`) comes before the label, as decoration: hidden from assistive
 * technology, so the link's name is the label alone.
 */
export function NavLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  const current = usePathname() === href;
  return (
    <SidebarMenuButton
      isActive={current}
      aria-current={current ? 'page' : undefined}
      render={<Link href={href} />}
    >
      {icon}
      <span>{label}</span>
    </SidebarMenuButton>
  );
}
