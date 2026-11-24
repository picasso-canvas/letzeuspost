/** What a target is cut to, so the shortened text lands under the room and not on its edge (§08). */
const MARGIN = 0.95;

/** Floating-point error in `current × ratio × 0.95` must not turn a whole answer (38) into 37.999…, then 37. */
const EPSILON = 1e-9;

/**
 * The length a field is shortened to (§08 The fit check): its current length × (room available ÷ room needed at 85%)
 * × 0.95, rounded down, so the AI gets a number and not "make it shorter". `available` and `needed` are in the same
 * unit (pixels of block height or width). It never asks for more than the field has, and never for less than one
 * grapheme where there is something to keep.
 */
export function targetGraphemes(current: number, available: number, needed: number): number {
  if (current <= 0 || needed <= 0 || available >= needed) return current;
  if (available <= 0) return 1;
  const target = Math.floor((current * available * MARGIN) / needed + EPSILON);
  return Math.min(current, Math.max(1, target));
}
