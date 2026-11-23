// The Clean look's own tokens (§07: calm, lots of space, rounded sans, a soft tinted ground, highlight = underline).
// They become CSS variables on the page next to the brand's (`page/theme.ts`); the brand's colours and fonts fill the
// rest. Not here, on purpose: sizes, margins and line-heights, which the shared base owns (§07: not adjustable).

/**
 * How much of the brand's primary is mixed into its background (`color-mix` in sRGB): the ground every slide sits on,
 * the soft decoration shape, and the highlight pill. The contrast pairs (`contrast.ts`) mix the same shares.
 */
export const CLEAN_TINT = { ground: 0.06, shape: 0.14, pill: 0.2 } as const;

const percent = (share: number): string => `${String(Math.round(share * 100))}%`;

export const CLEAN_TOKENS: Record<string, string> = {
  'clean-ground-tint': percent(CLEAN_TINT.ground),
  'clean-shape-tint': percent(CLEAN_TINT.shape),
  'clean-pill-tint': percent(CLEAN_TINT.pill),
  // The corner switch: the radius of frames and the highlight pill, and of the decoration shape (a share of its size)
  'clean-radius-sharp': '0px',
  'clean-radius-soft': '20px',
  'clean-radius-round': '999px',
  'clean-shape-radius-sharp': '0%',
  'clean-shape-radius-soft': '22%',
  'clean-shape-radius-round': '50%',
  // The highlight: an underline in the primary, below the letters' lowest marks (Bangla ু ূ ৃ included)
  'clean-underline': '0.08em',
  'clean-underline-offset': '0.2em',
  // The "print" image frame: a border in the brand's background, ringed with the shape tint
  'clean-print-border': '16px',
  'clean-print-ring': '3px',
};
