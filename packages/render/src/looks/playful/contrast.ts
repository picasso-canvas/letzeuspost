import type { ContrastResult } from '../../contrast/apply.ts';
import type { TextPair } from '../../contrast/pairs.ts';
import type { RenderKit } from '../../kit.ts';
import type { SizeName } from '../../sizes.ts';

// The Playful look's text pairs for the contrast check. Not written yet.

export function playfulTints(kit: RenderKit): { badge: string } {
  return { badge: kit.colors.background };
}

export function playfulPairs(_kit: RenderKit, _size: SizeName): TextPair[] {
  return [];
}

export function playfulContrast(kit: RenderKit): ContrastResult {
  return { kit, warnings: [], failures: [] };
}
