import { z } from 'zod';
import { LookSchema } from '../post/look.ts';
import { SIZE_NAMES } from '../post/sizes.ts';

// The brand kit (§06 What a kit holds): one typed shape the brand editor, the drafting job and the renderer share.
// Every part is there from the start, and every field of a part is optional: a kit begins empty and fills as the agency
// answers, uploads and types (§06 Every way to start a kit). The five essentials that must be there before the first
// batch are checked by `essentialsMissing`, not by the schema. Every item records where it came from and how sure we
// are (§06: "every item records where it came from, and when").

/** Where an item came from: an uploaded file, one of the 8 answers, typed by the agency, the client's words, a website. */
export const SOURCE_KINDS = ['file', 'answer', 'typed', 'client-said', 'website'] as const;

/** How sure the kit is of an item (§06): `needs-you` asks the agency to fill it in. */
export const CONFIDENCES = ['found', 'guessed', 'needs-you'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * The asset key the renderer gets when a kit has no logo: a temporary wordmark (the name in the heading font and the
 * primary colour, §06 Missing pieces), shown as "temporary" in the editor. Stored assets have ids, so no real asset
 * has this key, and the kit refuses it as an asset.
 */
export const TEMPORARY_WORDMARK = 'temporary-wordmark';

/** Text the agency or a reader wrote: trimmed, not empty, and bounded (no kit field needs more than a long note). */
const text = z.string().trim().min(1).max(2000);

/** Colours go into CSS, so only six-digit hex is taken (the renderer's rule, `RenderKitSchema`). */
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a six-digit hex colour like #1b1b1b');

/** A stored asset (logo, mascot) by its key, never by a web address; the renderer's `ASSET_KEY`. */
const assetKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'an asset key, not a web address')
  .refine((key) => key !== TEMPORARY_WORDMARK, 'a stored asset, not the temporary-wordmark marker');

const language = z.enum(['en', 'bn']);

/** The 7 networks of §07 (`config/networks.ts`, which a package can't import). */
const network = z.enum([
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'tiktok',
  'pinterest',
]);

/** An IANA timezone (§13: a brand keeps its IANA timezone for display), as a region name like `Asia/Dhaka`. */
const timezone = z
  .string()
  .regex(/^(UTC|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+)$/, 'an IANA timezone like Asia/Dhaka')
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'an IANA timezone this runtime knows');

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // February has 29: a leap-day anniversary

/** A day that comes every year, as `MM-DD`. */
const monthDay = z.string().refine((value) => {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  const month = Number(match?.[1]);
  const day = Number(match?.[2]);
  return (
    match !== null &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (DAYS_IN_MONTH[month - 1] ?? 0)
  );
}, 'a day of the year as MM-DD');

/** What every item carries next to its value (§06). `ref` is the page URL, the file, the question or who said it. */
const item = <Value extends z.ZodType>(value: Value) =>
  z.strictObject({
    value,
    source: z.enum(SOURCE_KINDS),
    ref: z.string().max(2000).nullable(),
    /** When the item was recorded, in UTC. */
    at: z.iso.datetime(),
    confidence: z.enum(CONFIDENCES),
  });

/** A list of items, bounded. */
const items = <Value extends z.ZodType>(value: Value, max = 50) => z.array(item(value)).max(max);

const identity = z.strictObject({
  name: item(text).optional(),
  nameBn: item(text).optional(),
  shortName: item(text).optional(),
  logo: z
    .strictObject({ light: item(assetKey).optional(), dark: item(assetKey).optional() })
    .optional(),
  mark: item(assetKey).optional(),
  colors: z
    .strictObject({
      primary: item(colour).optional(),
      accent: item(colour).optional(),
      background: item(colour).optional(),
      ink: item(colour).optional(),
      extras: items(colour, 8).optional(),
    })
    .optional(),
  /** A heading and a body font per language, by family name (the renderer checks them against its font manifest). */
  fonts: z
    .strictObject({
      en: z
        .strictObject({ heading: item(text).optional(), body: item(text).optional() })
        .optional(),
      bn: z
        .strictObject({ heading: item(text).optional(), body: item(text).optional() })
        .optional(),
    })
    .optional(),
  mascot: item(assetKey).optional(),
});

const voice = z.strictObject({
  toneWords: items(text, 3).optional(),
  audience: item(text).optional(),
  pillars: items(text, 6).optional(),
  wordsToUse: items(text).optional(),
  wordsToAvoid: items(text).optional(),
  callsToAction: items(text).optional(),
  /** A bank to draw from; the limit per Instagram post (5, §07) is checked on the post. */
  hashtags: items(text, 30).optional(),
  examplePosts: items(text, 20).optional(),
  mainLanguage: z.partialRecord(network, item(language)).optional(),
  writerNotes: item(text).optional(),
});

/** A price with the day it was checked (§06 Facts): a price is only as good as its date. */
const price = z.strictObject({ what: text, price: text, checkedOn: z.iso.date() });

const facts = z.strictObject({
  sells: items(text).optional(),
  prices: items(price).optional(),
  openingHours: item(text).optional(),
  locations: items(text).optional(),
  contacts: items(text).optional(),
  founded: item(text).optional(),
  different: items(text).optional(),
});

const look = z.strictObject({ look: item(LookSchema).optional() });

const rules = z.strictObject({
  claimsToAvoid: items(text).optional(),
  requiredLines: items(text).optional(),
  restrictedIndustry: item(z.boolean()).optional(),
  topicsToSkip: items(text).optional(),
  memes: item(z.boolean()).optional(),
  competitors: items(text).optional(),
});

const publishing = z.strictObject({
  accounts: items(z.strictObject({ network, handle: text })).optional(),
  sizes: z.partialRecord(network, item(z.enum(SIZE_NAMES))).optional(),
  timezone: item(timezone).optional(),
  /** Usual posting times, 24-hour `HH:MM` in the brand's timezone. */
  postingTimes: items(
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM'),
    28,
  ).optional(),
  /** §11: none, agency, or agency then client. */
  approvalMode: item(z.enum(['none', 'agency', 'agency-then-client'])).optional(),
  reviewers: items(z.strictObject({ name: text, email: z.email() }), 20).optional(),
  /** The Pinterest board the Metricool CSV needs (§12). */
  pinterestBoard: item(text).optional(),
});

const holidays = z.strictObject({
  /** A two-letter ISO 3166-1 country code. */
  country: item(z.string().regex(/^[A-Z]{2}$/, 'a two-letter country code like BD')).optional(),
  /** A curated or public holiday switched on or off for this brand. */
  switches: items(z.strictObject({ holiday: text, on: z.boolean() }), 100).optional(),
  /** Dates of the brand's own, like its anniversary. */
  custom: items(z.strictObject({ name: text, monthDay }), 50).optional(),
});

export const BrandKitSchema = z.strictObject({
  identity,
  voice,
  facts,
  look,
  rules,
  publishing,
  holidays,
});

export type BrandKit = z.infer<typeof BrandKitSchema>;
