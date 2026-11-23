import { contrastRatio, parseHex, toHex } from './colour.ts';

// The scrim rule (§08): text never sits on a photo without a scrim of at least 60%. A black scrim at 60% over the
// brightest possible photo (white) leaves #666666, and white text on that is about 5.7:1, so the contrast of text on a
// photo is computed from the tokens and never guessed from the pixels.

/** The scrim's opacity: never lower than 0.6 (§08). */
export const SCRIM_ALPHA = 0.6;

export type Scrim = { colour: string; alpha: number };

const WHITE = '#ffffff';
const BLACK = '#000000';

/** `colour` laid over `under` at `alpha`. */
function over(colour: string, alpha: number, under: string): string {
  const [c, u] = [parseHex(colour), parseHex(under)];
  return toHex([
    c[0] * alpha + u[0] * (1 - alpha),
    c[1] * alpha + u[1] * (1 - alpha),
    c[2] * alpha + u[2] * (1 - alpha),
  ]);
}

/** The scrim colour that leaves `text` the better worst case: black under light text, white under dark text. */
function scrimColour(text: string): string {
  const worst = (scrim: string) =>
    Math.min(
      contrastRatio(text, over(scrim, SCRIM_ALPHA, WHITE)),
      contrastRatio(text, over(scrim, SCRIM_ALPHA, BLACK)),
    );
  return worst(WHITE) > worst(BLACK) ? WHITE : BLACK;
}

/** The scrim to paint between a photo and text in `textColour` (`#rrggbb`). */
export function scrimFor(textColour: string): Scrim {
  parseHex(textColour); // refuse what isn't a colour
  return { colour: scrimColour(textColour), alpha: SCRIM_ALPHA };
}

/**
 * What text in `textColour` sits on at the two extremes of a photo, brightest (white) first, darkest (black) second,
 * once the scrim is over it. A photo between the two gives a result between them, so these are the worst cases.
 */
export function photoBackdrops(textColour: string): string[] {
  const { colour, alpha } = scrimFor(textColour);
  return [over(colour, alpha, WHITE), over(colour, alpha, BLACK)];
}
