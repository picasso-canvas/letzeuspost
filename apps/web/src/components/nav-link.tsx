'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SidebarMenuButton } from '@lzp/ui/components/sidebar';

/** A sidebar link that marks itself as the current page (`aria-current`, and the sidebar's current style) on its path. */
export function NavLink({ href, label }: { href: string; label: string }) {
  const current = usePathname() === href;
  return (
    <SidebarMenuButton
      isActive={current}
      aria-current={current ? 'page' : undefined}
      render={<Link href={href} />}
    >
      <span>{label}</span>
    </SidebarMenuButton>
  );
}
