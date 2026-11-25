// Sample brand kits for the brand tests: a Bangladeshi café with every part filled, and the same café with nothing.
import type { BrandKit } from './kit.ts';

/** One kit item: its value, and where it came from (a typed one unless said otherwise). */
export function item<T>(
  value: T,
  over: { source?: string; ref?: string | null; at?: string; confidence?: string } = {},
): {
  value: T;
  source: string;
  ref: string | null;
  at: string;
  confidence: string;
} {
  return {
    value,
    source: over.source ?? 'typed',
    ref: over.ref === undefined ? null : over.ref,
    at: over.at ?? '2026-11-20T09:30:00.000Z',
    confidence: over.confidence ?? 'found',
  };
}

/** A kit with nothing in it: every part is there, no item is. */
export const emptyKit = (): Record<string, Record<string, unknown>> => ({
  identity: {},
  voice: {},
  facts: {},
  look: {},
  rules: {},
  publishing: {},
  holidays: {},
});

/** A kit with every part filled, as an agency's editor would save it. */
export function fullKit(): BrandKit {
  const website = { source: 'website', ref: 'https://golpo.example/about', confidence: 'found' };
  return {
    identity: {
      name: item('Golpo Café'),
      nameBn: item('গল্প ক্যাফে'),
      shortName: item('Golpo'),
      logo: {
        light: item('logo_light_1', { source: 'file', ref: 'upload:logo.png' }),
        dark: item('logo_dark_1', { source: 'file', ref: 'upload:logo-dark.png' }),
      },
      mark: item('mark_1', { source: 'file', ref: 'upload:logo.png' }),
      colors: {
        primary: item('#8b2e16', website),
        accent: item('#f2b134', website),
        background: item('#fff8ee', { source: 'answer', ref: 'colors you like' }),
        ink: item('#1b1b1b'),
        extras: [item('#2f6f4f', { source: 'file', ref: 'upload:post-3.png' })],
      },
      fonts: {
        en: { heading: item('Baloo 2'), body: item('Nunito') },
        bn: { heading: item('Baloo Da 2'), body: item('Hind Siliguri') },
      },
      mascot: item('mascot_1', { source: 'file', ref: 'upload:mascot.png' }),
    },
    voice: {
      toneWords: [item('warm'), item('playful'), item('homely', { confidence: 'guessed' })],
      audience: item('Students and office workers in Dhaka', { source: 'answer', ref: 'q2' }),
      pillars: [item('Pitha season'), item('Behind the counter'), item('Regulars')],
      wordsToUse: [item('ghorowa')],
      wordsToAvoid: [item('cheap')],
      callsToAction: [item('Come by this weekend')],
      hashtags: [item('#golpocafe')],
      examplePosts: [
        item('শীতের সকালে গরম পিঠা, আজই চলে আসুন।', { source: 'file', ref: 'upload:post-1.png' }),
      ],
      mainLanguage: { instagram: item('bn'), facebook: item('bn'), linkedin: item('en') },
      writerNotes: item('Never joke about prices.'),
    },
    facts: {
      sells: [item('Pitha and tea', { source: 'answer', ref: 'q1' })],
      prices: [item({ what: 'Bhapa pitha', price: '৳60', checkedOn: '2026-11-18' }, website)],
      openingHours: item('Daily 8am to 10pm', website),
      locations: [item('House 12, Road 5, Dhanmondi, Dhaka', website)],
      contacts: [item('hello@golpo.example', website)],
      founded: item('2019', { source: 'client-said', ref: 'call with the owner' }),
      different: [
        item('Pitha made on the spot', { source: 'client-said', ref: 'call with the owner' }),
      ],
    },
    look: { look: item({ name: 'playful', switches: { corners: 'round' } }) },
    rules: {
      claimsToAvoid: [item('healthiest')],
      requiredLines: [item('Terms apply')],
      restrictedIndustry: item(false),
      topicsToSkip: [item('politics')],
      memes: item(false),
      competitors: [item('Another Café')],
    },
    publishing: {
      accounts: [item({ network: 'instagram', handle: 'golpocafe' })],
      sizes: { instagram: item('portrait') },
      timezone: item('Asia/Dhaka'),
      postingTimes: [item('18:30')],
      approvalMode: item('agency'),
      reviewers: [item({ name: 'Nadia Rahman', email: 'nadia@golpo.example' })],
      pinterestBoard: item('Golpo pitha'),
    },
    holidays: {
      country: item('BD', { source: 'answer', ref: 'q3' }),
      switches: [item({ holiday: 'bd-victory-day', on: true })],
      custom: [item({ name: 'Golpo anniversary', monthDay: '03-14' })],
    },
  } as unknown as BrandKit;
}
