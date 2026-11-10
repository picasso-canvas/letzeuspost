// The sizes and the 7 networks (§07 Sizes, Networks): which size each network gets and the limits behind it. Limits
// change often, so each one carries its source, official (O) or third-party (3P, only where the official pages are
// silent), with its link and the date it was checked; they are re-checked before launch (§07). Checking captions
// against these limits is later work; the counters are #33.
import { z } from 'zod';

const CHECKED = '2026-11-06';

// §07's sources.
const links = {
  instagramMedia:
    'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
  instagramPublishing: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  instagramHashtags: 'https://betanews.com/2025/12/19/instagram-puts-a-limit-on-hashtag-usage',
  facebookPhotos: 'https://developers.facebook.com/docs/graph-api/reference/page/photos',
  linkedinImagesHelp: 'https://www.linkedin.com/help/linkedin/answer/100983',
  linkedinImagesApi:
    'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api',
  linkedinDocumentsApi:
    'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api',
  xMedia: 'https://docs.x.com/x-api/media/quickstart/best-practices',
  xCounting: 'https://docs.x.com/fundamentals/counting-characters',
  threadsOverview: 'https://developers.facebook.com/docs/threads/overview',
  threadsPublishing: 'https://developers.facebook.com/docs/threads/reference/publishing',
  tiktokPhotoPost: 'https://developers.tiktok.com/doc/content-posting-api-reference-photo-post',
  tiktokMedia: 'https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide',
  pinterestSpecs: 'https://help.pinterest.com/business/article/pinterest-product-specs',
  pinterestAltText:
    'https://help.pinterest.com/en/business/article/add-alternative-text-to-your-pins',
} as const;

const official = (url: string) => ({ kind: 'O' as const, url, checked: CHECKED });
/** A third-party figure; `null` where §07 quotes it without a link (the limit's note says why). */
const thirdParty = (url: string | null) => ({ kind: '3P' as const, url, checked: CHECKED });

const sizeName = z.enum(['portrait', 'square', 'story', 'landscape', 'pin']);

const sizeSchema = z
  .strictObject({
    width: z.int().positive(),
    height: z.int().positive(),
    ratio: z.string().regex(/^\d+:\d+$/),
  })
  .refine(({ width, height, ratio }) => {
    const [w = 0, h = 0] = ratio.split(':').map(Number);
    return width * h === height * w;
  }, 'The pixels must match the ratio');

const sourceSchema = z.strictObject({
  kind: z.enum(['O', '3P']),
  url: z.url({ protocol: /^https$/ }).nullable(),
  checked: z.iso.date(),
});

/** What every limit carries: its source, and a note for what the number alone doesn't say. */
const sourced = { source: sourceSchema, note: z.string().min(1).optional() };

/** An official source always has a link; a third-party one without a link says why in its note. */
const hasLinkOrReason = (limit: {
  source: { kind: string; url: string | null };
  note?: string | undefined;
}) => limit.source.url !== null || (limit.source.kind === '3P' && limit.note !== undefined);
const NO_LINK = 'A limit needs a link, or a third-party note saying why it has none';

const max = z.int().positive();

/** How a network counts a caption (§07 decision 3): X weighted characters, TikTok UTF-16 units, Threads bytes for emoji. */
const counting = z.enum(['characters', 'weighted', 'utf16', 'emoji-bytes']);

const countLimit = z.strictObject({ max, ...sourced }).refine(hasLinkOrReason, NO_LINK);
/** `max: null`: the network documents no limit. */
const openLimit = z
  .strictObject({ max: max.nullable(), ...sourced })
  .refine(hasLinkOrReason, NO_LINK);
const textLimit = z.strictObject({ max, counting, ...sourced }).refine(hasLinkOrReason, NO_LINK);

const altTextSchema = z
  .discriminatedUnion('supported', [
    z.strictObject({
      supported: z.literal(true),
      max: max.nullable(),
      /** Where the network takes no alt text. */
      notFor: z.array(z.enum(['story', 'carousel'])).optional(),
      ...sourced,
    }),
    z.strictObject({ supported: z.literal(false), ...sourced }),
  ])
  .refine(hasLinkOrReason, NO_LINK);

const fileSchema = z
  .strictObject({
    formats: z.array(z.enum(['jpeg', 'png', 'gif', 'webp'])).min(1),
    maxMb: z.number().positive().nullable(),
    ...sourced,
  })
  .refine(hasLinkOrReason, NO_LINK);

const networkSchema = z
  .strictObject({
    name: z.string().min(1),
    /** LetZeusPost's default size per kind of post; `story: null` where the network gets no story. */
    sizes: z.strictObject({
      single: sizeName,
      /** X: 1:1 when the text doesn't fit at 16:9 (§08). */
      singleFallback: sizeName.optional(),
      carousel: sizeName,
      story: sizeName.nullable(),
    }),
    /** Our carousel cap (§07 decision 4) and how a carousel goes out: images, or one PDF document. */
    carousel: z.strictObject({ max: z.int().min(2), as: z.enum(['images', 'pdf']) }),
    /** Whether the network takes a post without media. */
    textOnly: z.boolean(),
    imagesPerPost: openLimit,
    caption: textLimit,
    title: textLimit.optional(),
    mentions: countLimit.optional(),
    links: countLimit.optional(),
    /** `null`: §07 gives no hashtag limit for the network. */
    hashtags: countLimit.nullable(),
    altText: altTextSchema,
    file: fileSchema,
    /** LinkedIn document posts. */
    document: z
      .strictObject({ maxPages: max, maxMb: z.number().positive(), ...sourced })
      .refine(hasLinkOrReason, NO_LINK)
      .optional(),
  })
  .refine(
    ({ carousel, imagesPerPost }) =>
      imagesPerPost.max === null || carousel.max <= imagesPerPost.max,
    'Our carousel cap is never above what the network takes',
  );

export const networksConfigSchema = z.strictObject({
  sizes: z.record(sizeName, sizeSchema),
  networks: z.record(
    z.enum(['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'pinterest']),
    networkSchema,
  ),
});

export type NetworksConfig = z.input<typeof networksConfigSchema>;
export type SizeName = z.infer<typeof sizeName>;
export type NetworkName = keyof NetworksConfig['networks'];
export type Network = z.infer<typeof networkSchema>;

export const sizes: NetworksConfig['sizes'] = {
  portrait: { width: 1080, height: 1350, ratio: '4:5' },
  square: { width: 1080, height: 1080, ratio: '1:1' },
  story: { width: 1080, height: 1920, ratio: '9:16' },
  landscape: { width: 1200, height: 675, ratio: '16:9' },
  pin: { width: 1000, height: 1500, ratio: '2:3' },
};

export const networks: Record<NetworkName, Network> = {
  instagram: {
    name: 'Instagram',
    sizes: { single: 'portrait', carousel: 'portrait', story: 'story' },
    carousel: { max: 10, as: 'images' },
    textOnly: false,
    imagesPerPost: {
      max: 20,
      source: official(links.instagramPublishing),
      note: "every carousel slide is cropped to the first slide's ratio; 3:4 works in the app, not the API",
    },
    caption: { max: 2_200, counting: 'characters', source: official(links.instagramMedia) },
    mentions: { max: 20, source: official(links.instagramMedia), note: '@-tags in a caption' },
    hashtags: {
      max: 5,
      source: thirdParty(links.instagramHashtags),
      note: 'since Dec 2025; the API page still says 30, so we enforce 5',
    },
    altText: {
      supported: true,
      max: 1_000,
      notFor: ['story'],
      source: official(links.instagramMedia),
    },
    file: { formats: ['jpeg'], maxMb: 8, source: official(links.instagramMedia) },
  },
  facebook: {
    name: 'Facebook',
    sizes: { single: 'portrait', carousel: 'portrait', story: 'story' },
    carousel: { max: 10, as: 'images' },
    textOnly: true,
    imagesPerPost: { max: null, source: official(links.facebookPhotos), note: 'not documented' },
    caption: {
      max: 63_206,
      counting: 'characters',
      source: thirdParty(null),
      note: 'widely quoted, not found officially',
    },
    hashtags: null,
    altText: {
      supported: true,
      max: null,
      source: official(links.facebookPhotos),
      note: 'the alt_text_custom field',
    },
    file: {
      formats: ['jpeg', 'png'],
      maxMb: 10,
      source: official(links.facebookPhotos),
      note: 'and other formats; a PNG over 1 MB may look pixelated',
    },
  },
  linkedin: {
    name: 'LinkedIn',
    sizes: { single: 'portrait', carousel: 'portrait', story: null },
    carousel: { max: 10, as: 'pdf' },
    textOnly: true,
    imagesPerPost: { max: 20, source: official(links.linkedinImagesHelp) },
    caption: {
      max: 3_000,
      counting: 'characters',
      source: thirdParty(null),
      note: 'widely quoted, not confirmed',
    },
    hashtags: null,
    altText: {
      supported: true,
      max: 4_086,
      source: official(links.linkedinImagesApi),
      note: 'under 120 characters recommended',
    },
    file: {
      formats: ['jpeg', 'png', 'gif'],
      maxMb: null,
      source: official(links.linkedinImagesApi),
    },
    document: {
      maxPages: 300,
      maxMb: 100,
      source: official(links.linkedinDocumentsApi),
      note: 'a PDF; all pages the same size; a title is required',
    },
  },
  x: {
    name: 'X',
    sizes: { single: 'landscape', singleFallback: 'square', carousel: 'square', story: null },
    carousel: { max: 4, as: 'images' },
    textOnly: true,
    imagesPerPost: {
      max: 4,
      source: official(links.xMedia),
      note: 'extreme ratios and multi-image grids get cropped (3P)',
    },
    caption: {
      max: 280,
      counting: 'weighted',
      source: official(links.xCounting),
      note: 'emoji and CJK count 2, any URL 23; Bangla counts 1 per character',
    },
    hashtags: null,
    altText: {
      supported: true,
      max: 1_000,
      source: thirdParty(null),
      note: 'supported; the 1,000-character limit is not verified',
    },
    file: { formats: ['jpeg', 'png', 'gif', 'webp'], maxMb: 5, source: official(links.xMedia) },
  },
  threads: {
    name: 'Threads',
    sizes: { single: 'portrait', carousel: 'portrait', story: null },
    carousel: { max: 10, as: 'images' },
    textOnly: true,
    imagesPerPost: {
      max: 20,
      source: official(links.threadsPublishing),
      note: '2–20 in a carousel',
    },
    caption: {
      max: 500,
      counting: 'emoji-bytes',
      source: official(links.threadsOverview),
      note: 'through the API each emoji counts as its byte length',
    },
    links: {
      max: 5,
      source: official(links.threadsOverview),
      note: 'more than 5 links fails, since Dec 2025',
    },
    hashtags: { max: 1, source: thirdParty(null), note: 'one topic tag' },
    altText: { supported: true, max: 1_000, source: official(links.threadsPublishing) },
    file: { formats: ['jpeg', 'png'], maxMb: 8, source: official(links.threadsOverview) },
  },
  tiktok: {
    name: 'TikTok',
    sizes: { single: 'story', carousel: 'story', story: null },
    carousel: { max: 10, as: 'images' },
    textOnly: false,
    imagesPerPost: { max: 35, source: official(links.tiktokPhotoPost) },
    title: { max: 90, counting: 'utf16', source: official(links.tiktokPhotoPost) },
    caption: {
      max: 4_000,
      counting: 'utf16',
      source: official(links.tiktokPhotoPost),
      note: 'the description',
    },
    hashtags: null,
    altText: { supported: false, source: official(links.tiktokPhotoPost), note: 'no field' },
    file: {
      formats: ['jpeg', 'webp'],
      maxMb: 20,
      source: official(links.tiktokMedia),
      note: 'at most 1080p',
    },
  },
  pinterest: {
    name: 'Pinterest',
    sizes: { single: 'pin', carousel: 'pin', story: null },
    carousel: { max: 5, as: 'images' },
    textOnly: false,
    imagesPerPost: {
      max: 5,
      source: official(links.pinterestSpecs),
      note: 'a carousel of 2–5 images, 1:1 or 2:3; taller pins get cut off',
    },
    title: {
      max: 100,
      counting: 'characters',
      source: official(links.pinterestSpecs),
      note: 'about 40 shown',
    },
    caption: {
      max: 800,
      counting: 'characters',
      source: official(links.pinterestSpecs),
      note: 'the description',
    },
    // No hashtag limit documented (O).
    hashtags: null,
    altText: {
      supported: true,
      max: 500,
      notFor: ['carousel'],
      source: official(links.pinterestAltText),
    },
    file: { formats: ['png', 'jpeg'], maxMb: 20, source: official(links.pinterestSpecs) },
  },
};

networksConfigSchema.parse({ sizes, networks });
