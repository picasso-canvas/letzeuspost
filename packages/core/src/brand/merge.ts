import type { BrandKit } from './kit.ts';

// New findings (reading the website again, more files, the answers) arrive as suggestions and never overwrite what
// the agency typed (§06 The brand editor).

type Record_ = Record<string, unknown>;

const isRecord = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An item is the `{ value, source, ref, at, confidence }` object every kit field is made of. */
const isItem = (value: unknown): value is Record_ & { source: unknown } =>
  isRecord(value) && 'value' in value && 'source' in value && 'confidence' in value;

const isTyped = (value: unknown): boolean => isItem(value) && value.source === 'typed';

/**
 * - An item the agency typed stays; any other item takes the suggestion, with its source, time and confidence.
 * - A list is one field: if the agency typed any item in it, the whole list stays (a suggestion can't push it past
 *   its limit or reorder it); otherwise the suggested list replaces it.
 * - Groups and per-network maps merge key by key; a key the suggestions don't mention stays.
 */
function merge(existing: unknown, suggested: unknown): unknown {
  if (suggested === undefined) return existing;
  if (existing === undefined) return suggested;
  if (isItem(existing)) return isTyped(existing) ? existing : suggested;
  if (Array.isArray(existing)) return existing.some(isTyped) ? existing : suggested;
  if (isRecord(existing) && isRecord(suggested)) {
    const merged: Record_ = { ...existing };
    for (const [key, value] of Object.entries(suggested)) merged[key] = merge(existing[key], value);
    return merged;
  }
  return existing; // not the same shape: keep what the kit has
}

/** The kit with the suggestions applied wherever the agency hasn't typed. Neither argument is changed. */
export function mergeSuggestions(kit: BrandKit, suggestions: Partial<BrandKit>): BrandKit {
  return merge(kit, suggestions) as BrandKit;
}
