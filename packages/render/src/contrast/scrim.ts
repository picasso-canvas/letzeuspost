// The scrim rule (§08): text never sits on a photo without a scrim of at least 60%.

export const SCRIM_ALPHA = 0;

export type Scrim = { colour: string; alpha: number };

export function scrimFor(_textColour: string): Scrim {
  throw new Error('not implemented');
}

export function photoBackdrops(_textColour: string): string[] {
  throw new Error('not implemented');
}
