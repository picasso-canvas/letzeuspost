import { describe, expect, it } from 'vitest';
import { BrandKitSchema } from './kit.ts';
import { mergeSuggestions } from './merge.ts';
import { emptyKit, fullKit, item } from './test-fixtures.ts';

const found = <const Value extends string>(value: Value, ref: string) =>
  item(value, { source: 'website', ref, at: '2026-11-25T08:00:00.000Z', confidence: 'guessed' });

describe('mergeSuggestions', () => {
  it('never overwrites an item the agency typed', () => {
    const kit = fullKit();
    const merged = mergeSuggestions(kit, {
      identity: { name: found('Golpo Cafe Dhaka', 'https://golpo.example') },
    });
    expect(merged.identity.name).toEqual(item('Golpo Café'));
  });

  it('overwrites an item that came from anywhere else, and takes the new source with it', () => {
    for (const source of ['website', 'file', 'answer', 'client-said'] as const) {
      const kit = {
        ...emptyKit(),
        identity: { name: item('Old name', { source, confidence: 'guessed' }) },
      };
      const suggestion = found('Golpo Café', 'https://golpo.example/about');
      const merged = mergeSuggestions(kit, { identity: { name: suggestion } });
      expect(merged.identity.name).toEqual(suggestion);
    }
  });

  it('fills what is missing, in any part', () => {
    const suggestion = found('#8b2e16', 'https://golpo.example');
    const merged = mergeSuggestions(emptyKit(), {
      identity: { colors: { primary: suggestion } },
      holidays: { country: found('BD', 'q3') },
    });
    expect(merged.identity.colors?.primary).toEqual(suggestion);
    expect(merged.holidays.country?.value).toBe('BD');
  });

  it('keeps what the suggestions do not mention', () => {
    const kit = fullKit();
    expect(mergeSuggestions(kit, {})).toEqual(kit);
    expect(mergeSuggestions(kit, { voice: {} })).toEqual(kit);
  });

  it('keeps the typed item and takes the rest, next to it in the same group', () => {
    const kit = fullKit(); // ink is typed; primary came from the website; the one extra colour from a file
    const merged = mergeSuggestions(kit, {
      identity: {
        colors: {
          ink: found('#000000', 'https://golpo.example'),
          primary: found('#aa0000', 'https://golpo.example'),
          extras: [found('#445566', 'screenshot')],
        },
      },
    });
    expect(merged.identity.colors?.ink).toEqual(kit.identity.colors?.ink);
    expect(merged.identity.colors?.primary?.value).toBe('#aa0000');
    expect(merged.identity.colors?.extras?.map((colour) => colour.value)).toEqual(['#445566']);
  });

  it('leaves a list alone when the agency typed any item in it', () => {
    const kit = fullKit(); // tone words: two typed, one guessed
    const merged = mergeSuggestions(kit, {
      voice: { toneWords: [found('bold', 'https://golpo.example')] },
    });
    expect(merged.voice.toneWords).toEqual(kit.voice.toneWords);
  });

  it('replaces a list whose items were all found, not typed', () => {
    const kit = {
      ...emptyKit(),
      voice: { toneWords: [item('calm', { source: 'website', ref: 'https://golpo.example' })] },
    };
    const merged = mergeSuggestions(kit, {
      voice: { toneWords: [found('warm', 'https://golpo.example/about')] },
    });
    expect(merged.voice.toneWords?.map((tone) => tone.value)).toEqual(['warm']);
  });

  it('never overwrites a typed item inside a per-network entry either', () => {
    const kit = fullKit();
    const merged = mergeSuggestions(kit, {
      voice: { mainLanguage: { instagram: found('en', 'q4'), x: found('en', 'q4') } },
    });
    expect(merged.voice.mainLanguage?.instagram).toEqual(kit.voice.mainLanguage?.instagram);
    expect(merged.voice.mainLanguage?.x?.value).toBe('en'); // a network with nothing typed takes it
  });

  it('keeps a typed item whatever the suggestion says, even a newer one with more confidence', () => {
    const typed = item('Golpo Café', { confidence: 'needs-you' });
    const kit = { ...emptyKit(), identity: { name: typed } };
    const merged = mergeSuggestions(kit, {
      identity: {
        name: item('Golpo', {
          source: 'file',
          at: '2030-01-01T00:00:00.000Z',
          confidence: 'found',
        }),
      },
    });
    expect(merged.identity.name).toEqual(typed);
  });

  it('does not change the kit it was given', () => {
    const kit = fullKit();
    const before = structuredClone(kit);
    mergeSuggestions(kit, { identity: { name: found('X', 'y'), shortName: found('X', 'y') } });
    expect(kit).toEqual(before);
  });

  it('gives back a valid kit', () => {
    const merged = mergeSuggestions(fullKit(), {
      identity: { shortName: found('Golpo', 'https://golpo.example') },
      voice: { audience: found('Everyone in Dhanmondi', 'https://golpo.example') },
    });
    expect(BrandKitSchema.safeParse(merged).success).toBe(true);
  });
});

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

/** The field names of every object schema reachable from `schema` (through optional, array, record and union). */
const objectKeys = (schema: unknown, seen = new Set<unknown>()): string[][] => {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = record(record(record(schema)?.['_zod'])?.['def']);
  if (def === undefined) return [];
  const shape = record(def['shape']);
  const options = Array.isArray(def['options']) ? (def['options'] as unknown[]) : [];
  const children = [def['element'], def['innerType'], def['valueType'], def['in'], ...options];
  return [
    ...(shape === undefined ? [] : [Object.keys(shape)]),
    ...[...children, ...Object.values(shape ?? {})].flatMap((child) => objectKeys(child, seen)),
  ];
};

describe('the invariant merge.ts reads items by', () => {
  const ITEM_KEYS = ['at', 'confidence', 'ref', 'source', 'value'];
  const shapes = objectKeys(BrandKitSchema);
  const itemLike = shapes.filter((keys) =>
    ['value', 'source', 'confidence'].every((k) => keys.includes(k)),
  );

  it('finds the items in the schema, so the check below looks at something', () => {
    expect(itemLike.length).toBeGreaterThan(20);
  });

  it('holds: no group has a field set `value`, `source` and `confidence`; only items do', () => {
    for (const keys of itemLike) expect([...keys].sort()).toEqual(ITEM_KEYS);
  });
});
