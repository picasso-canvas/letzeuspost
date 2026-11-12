import type { ComponentProps } from 'react';
import { cn } from '@lzp/ui/lib/utils';

/**
 * The LetZeusPost mark (§03 Logo A, the crisp strike): the bolt, in ink, on the gold tile. The shapes are those of
 * docs/design/logos/letzeuspost/mark.svg (a test compares them); the colours are the tokens `primary` (gold fill) and
 * `primary-foreground` (ink), which are the same in light and dark, as the mark is. The wordmark beside it is text, set
 * by the screen.
 *
 * Decorative unless given a `title`: beside the app's name a screen reader skips it; alone it is an image with that name.
 */
function LogoMark({
  className,
  title,
  ...props
}: Omit<ComponentProps<'svg'>, 'children' | 'title'> & { title?: string }) {
  return (
    <svg
      data-slot="logo-mark"
      viewBox="0 0 64 64"
      className={cn('size-6 shrink-0', className)}
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      {...props}
    >
      <rect x="2" y="2" width="60" height="60" rx="16" className="fill-primary" />
      <path
        d="M39.5 6.5 L18.5 36 H31 L25 57.5 L46.5 27 H34.5 Z"
        className="fill-primary-foreground"
      />
    </svg>
  );
}

export { LogoMark };
