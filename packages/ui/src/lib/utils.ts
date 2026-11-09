import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// DESIGN.md's type sizes become `text-<name>`. tailwind-merge can't tell that `text-label` is a size, not a colour, and
// would drop it next to `text-muted-foreground`; so it is told the names. A test checks they match the generated
// tokens. (A weight is asked for as `font-(weight:--font-weight-<name>)`: `font-<name>` would be the font family.)
const typeSizes = ['body', 'meta', 'h1', 'h2', 'h3', 'eyebrow', 'label', 'button', 'numbers'];

const twMerge = extendTailwindMerge({ extend: { theme: { text: typeSizes } } });

/** Joins class names and lets a later Tailwind class win over an earlier one (shadcn/ui's `cn`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
