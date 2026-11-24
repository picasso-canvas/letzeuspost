// The Playful look's own tokens (§07: warm, friendly, heavy rounded display, tilted "print" photo frames, stickers,
// highlight = pill). They become CSS variables on the page next to the brand's (`page/theme.ts`); the brand's colours
// and fonts fill the rest. Not here, on purpose: font sizes, margins and line-heights, which the shared base owns
// (§07: not adjustable).

/** How much of the accent is mixed into the background for the badge sticker (`color-mix` in sRGB, `contrast.ts`). */
export const PLAYFUL_BADGE_TINT = 0.5;

// The stickers' sizes are shares of the page's shorter side, so they keep their proportions on every size. The tag's
// place is given by its centre, measured from the safe zones' corner like the badge, then written as the offset of its
// top-left corner, which is what CSS places.
const BADGE = 0.14;
const TAG = { width: 0.13, height: 0.056, centre: 0.13 };
const share = (value: number): string => String(Number(value.toFixed(4)));

export const PLAYFUL_TOKENS: Record<string, string> = {
  // The corner switch: the radius of frames and of the tag sticker, and of the highlight pill (in em, so it follows
  // the size of the text it sits in)
  'playful-radius-sharp': '0px',
  'playful-radius-soft': '24px',
  'playful-radius-round': '48px',
  'playful-pill-radius-sharp': '0em',
  'playful-pill-radius-soft': '0.3em',
  'playful-pill-radius-round': '0.65em',
  'playful-pill-pad': '0.22em',
  // The underline highlight: in the primary, below the letters' lowest marks (Bangla ু ূ ৃ included)
  'playful-underline': '0.1em',
  'playful-underline-offset': '0.2em',
  // The outline round the stickers and the print
  'playful-outline': '6px',
  // The "print" image frame: a border in the brand's background, deeper at the foot, turned a few degrees
  'playful-print-border': '18px',
  'playful-print-foot': '56px',
  'playful-print-tilt': '-3deg',
  // The stickers: a round badge in the corner of the safe zones, and a tag turned across its inner edge
  'playful-badge-tint': `${String(Math.round(PLAYFUL_BADGE_TINT * 100))}%`,
  'playful-badge-size': share(BADGE),
  'playful-tag-width': share(TAG.width),
  'playful-tag-height': share(TAG.height),
  'playful-tag-x': share(TAG.centre - TAG.width / 2),
  'playful-tag-y': share(TAG.centre - TAG.height / 2),
  'playful-tag-tilt': '-12deg',
};
