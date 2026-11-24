import { LookSchema, type SizeName } from '@lzp/core';
import type { z } from 'zod';

/** Every switch with a value (§07: corner style, image frame, highlight style, decorations, logo position). */
export type Switches = {
  corners: 'sharp' | 'soft' | 'round';
  frame: 'none' | 'print' | 'rounded' | 'full-bleed';
  highlight: 'default' | 'pill' | 'underline' | 'color';
  decorations: boolean;
  logo: 'bottom-left' | 'bottom-right' | 'top';
};

type Look = z.output<typeof LookSchema>;

/** What a switch is when the brand left it alone. A pin has its logo at the top (§08); the look's tokens do the rest. */
function defaults(size: SizeName): Switches {
  return {
    corners: 'soft',
    frame: 'none',
    highlight: 'default',
    decorations: true,
    logo: size === 'pin' ? 'top' : 'bottom-left',
  };
}

/**
 * The look's switches with the defaults filled in. The look is read through `LookSchema` again here, so a value that
 * isn't one of the switch's options throws instead of being left out (§07 safe switches, not free CSS).
 */
export function resolveSwitches(
  look: unknown,
  size: SizeName,
): { name: Look['name']; switches: Switches } {
  const { name, switches } = LookSchema.parse(look);
  const base = defaults(size);
  return {
    name,
    switches: {
      corners: switches.corners ?? base.corners,
      frame: switches.frame ?? base.frame,
      highlight: switches.highlight ?? base.highlight,
      decorations: switches.decorations ?? base.decorations,
      logo: switches.logo ?? base.logo,
    },
  };
}

/** The classes on the page: `corners-round frame-print hl-pill decor-off logo-top` (§08). */
export const switchClasses = (switches: Switches): string[] => [
  `corners-${switches.corners}`,
  `frame-${switches.frame}`,
  `hl-${switches.highlight}`,
  switches.decorations ? 'decor-on' : 'decor-off',
  `logo-${switches.logo}`,
];
