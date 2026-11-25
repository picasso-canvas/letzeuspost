import type { BrandKit } from './kit.ts';

/** The five things a kit needs before the first batch (§06), in the order the editor asks for them. */
export const ESSENTIALS = ['name', 'color', 'tone', 'language', 'country'] as const;

export type Essential = (typeof ESSENTIALS)[number];

/** An item counts when it is there and not waiting for the agency (`needs-you` is a question, not an answer). */
const filled = (item: { confidence: string } | undefined): boolean =>
  item !== undefined && item.confidence !== 'needs-you';

const anyFilled = (items: ({ confidence: string } | undefined)[]): boolean => items.some(filled);

/** The essentials the kit still lacks, in `ESSENTIALS` order. An empty list means the kit may go to its first batch. */
export function essentialsMissing(kit: BrandKit): Essential[] {
  const { identity, voice, holidays } = kit;
  const colors = identity.colors;
  const present: Record<Essential, boolean> = {
    name: anyFilled([identity.name, identity.nameBn]),
    color: anyFilled([
      colors?.primary,
      colors?.accent,
      colors?.background,
      colors?.ink,
      ...(colors?.extras ?? []),
    ]),
    tone: anyFilled(voice.toneWords ?? []),
    language: anyFilled(Object.values(voice.mainLanguage ?? {})),
    country: filled(holidays.country),
  };
  return ESSENTIALS.filter((essential) => !present[essential]);
}
