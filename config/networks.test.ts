import { describe, expect, it } from 'vitest';
import { networks, networksConfigSchema, sizes, type NetworksConfig } from './networks.ts';

// §07 Sizes.
const section07Sizes = {
  portrait: { width: 1080, height: 1350, ratio: '4:5' },
  square: { width: 1080, height: 1080, ratio: '1:1' },
  story: { width: 1080, height: 1920, ratio: '9:16' },
  landscape: { width: 1200, height: 675, ratio: '16:9' },
  pin: { width: 1000, height: 1500, ratio: '2:3' },
};

// §07 Networks, its source list: every link a limit may cite.
const section07Links = [
  'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
  'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  'https://lindseygamble.com/blog/instagram-now-supports-34-aspect-ratio-for-photos-and-carousel-posts',
  'https://betanews.com/2025/12/19/instagram-puts-a-limit-on-hashtag-usage',
  'https://developers.facebook.com/docs/graph-api/reference/page/photos',
  'https://developers.facebook.com/docs/page-stories-api',
  'https://www.linkedin.com/help/linkedin/answer/100983',
  'https://www.linkedin.com/help/linkedin/answer/97459',
  'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api',
  'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api',
  'https://docs.x.com/x-api/media/quickstart/best-practices',
  'https://docs.x.com/fundamentals/counting-characters',
  'https://developers.facebook.com/docs/threads/overview',
  'https://developers.facebook.com/docs/threads/reference/publishing',
  'https://developers.tiktok.com/doc/content-posting-api-reference-photo-post',
  'https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide',
  'https://help.pinterest.com/business/article/pinterest-product-specs',
  'https://help.pinterest.com/en/business/article/add-alternative-text-to-your-pins',
];

type Kind = 'O' | '3P';

// §07 "Which size each network gets" and "The limits behind that table". Each limit is [value, how §07 marks its
// source]; `null` hashtags means §07 gives no hashtag limit, `false` alt text means the network has no field.
const section07Networks = {
  instagram: {
    sizes: { single: 'portrait', carousel: 'portrait', story: 'story' },
    carousel: { max: 10, as: 'images' },
    textOnly: false,
    imagesPerPost: [20, 'O'],
    caption: [2_200, 'characters', 'O'],
    hashtags: [5, '3P'],
    altText: [1_000, 'O'],
    file: [['jpeg'], 8, 'O'],
  },
  facebook: {
    sizes: { single: 'portrait', carousel: 'portrait', story: 'story' },
    carousel: { max: 10, as: 'images' },
    textOnly: true,
    imagesPerPost: [null, 'O'],
    caption: [63_206, 'characters', '3P'],
    hashtags: null,
    altText: [null, 'O'],
    file: [['jpeg', 'png'], 10, 'O'],
  },
  linkedin: {
    sizes: { single: 'portrait', carousel: 'portrait', story: null },
    carousel: { max: 10, as: 'pdf' },
    textOnly: true,
    imagesPerPost: [20, 'O'],
    caption: [3_000, 'characters', '3P'],
    hashtags: null,
    altText: [4_086, 'O'],
    file: [['gif', 'jpeg', 'png'], null, 'O'],
  },
  x: {
    sizes: { single: 'landscape', singleFallback: 'square', carousel: 'square', story: null },
    carousel: { max: 4, as: 'images' },
    textOnly: true,
    imagesPerPost: [4, 'O'],
    caption: [280, 'weighted', 'O'],
    hashtags: null,
    altText: [1_000, '3P'],
    file: [['gif', 'jpeg', 'png', 'webp'], 5, 'O'],
  },
  threads: {
    sizes: { single: 'portrait', carousel: 'portrait', story: null },
    carousel: { max: 10, as: 'images' },
    textOnly: true,
    imagesPerPost: [20, 'O'],
    caption: [500, 'emoji-bytes', 'O'],
    hashtags: [1, '3P'],
    altText: [1_000, 'O'],
    file: [['jpeg', 'png'], 8, 'O'],
  },
  tiktok: {
    sizes: { single: 'story', carousel: 'story', story: null },
    carousel: { max: 10, as: 'images' },
    textOnly: false,
    imagesPerPost: [35, 'O'],
    caption: [4_000, 'utf16', 'O'],
    hashtags: null,
    altText: false,
    file: [['jpeg', 'webp'], 20, 'O'],
  },
  pinterest: {
    sizes: { single: 'pin', carousel: 'pin', story: null },
    carousel: { max: 5, as: 'images' },
    textOnly: false,
    imagesPerPost: [5, 'O'],
    caption: [800, 'characters', 'O'],
    hashtags: null,
    altText: [500, 'O'],
    file: [['jpeg', 'png'], 20, 'O'],
  },
} as const;

const names = Object.keys(section07Networks) as (keyof typeof section07Networks)[];

interface Sourced {
  source: { kind: Kind; url: string | null; checked: string };
  note?: string;
}

/** Every object with a `source` in the network table, with its path. */
function limits(value: unknown, path: string): [string, Sourced][] {
  if (typeof value !== 'object' || value === null) return [];
  if ('source' in value) return [[path, value as Sourced]];
  return Object.entries(value).flatMap(([key, child]) => limits(child, `${path}.${key}`));
}

const valid = (): NetworksConfig => structuredClone({ sizes, networks });

describe('config/networks.ts', () => {
  it('has the 5 sizes of §07 with their pixels and ratios', () => {
    expect(sizes).toEqual(section07Sizes);
  });

  it('has the 7 networks of §07', () => {
    expect(Object.keys(networks)).toEqual(names);
  });

  describe.each(names)('%s', (name) => {
    const network = networks[name];
    const expected = section07Networks[name];

    it('gets the default sizes, carousel cap and text-only rule of §07', () => {
      expect(network.sizes).toEqual(expected.sizes);
      expect(network.carousel).toEqual(expected.carousel);
      expect(network.textOnly).toBe(expected.textOnly);
    });

    it('has the images-per-post limit', () => {
      const [max, kind] = expected.imagesPerPost;
      expect(network.imagesPerPost.max).toBe(max);
      expect(network.imagesPerPost.source.kind).toBe(kind);
    });

    it('has the caption limit and the way the network counts it', () => {
      const [max, counting, kind] = expected.caption;
      expect(network.caption).toMatchObject({ max, counting, source: { kind } });
    });

    it('has the hashtag limit', () => {
      if (expected.hashtags === null) {
        expect(network.hashtags).toBeNull();
      } else {
        const [max, kind] = expected.hashtags;
        expect(network.hashtags).toMatchObject({ max, source: { kind } });
      }
    });

    it('has the alt-text limit', () => {
      if (expected.altText === false) {
        expect(network.altText).toMatchObject({ supported: false, source: { kind: 'O' } });
      } else {
        const [max, kind] = expected.altText;
        expect(network.altText).toMatchObject({ supported: true, max, source: { kind } });
      }
    });

    it('has the file formats and size limit', () => {
      const [formats, maxMb, kind] = expected.file;
      expect([...network.file.formats].sort()).toEqual(formats);
      expect(network.file).toMatchObject({ maxMb, source: { kind } });
    });

    it('never caps a carousel above what the network takes', () => {
      if (network.imagesPerPost.max !== null) {
        expect(network.carousel.max).toBeLessThanOrEqual(network.imagesPerPost.max);
      }
    });
  });

  it('gives every limit its source, from §07 list, and the date it was checked', () => {
    const all = limits(networks, 'networks');
    expect(all.length).toBeGreaterThanOrEqual(7 * 4);
    for (const [path, { source, note }] of all) {
      expect(source.checked, path).toBe('2026-11-06');
      if (source.url === null) {
        // §07 names no link for a few third-party figures ("widely quoted", "not verified"); each says why.
        expect(source.kind, path).toBe('3P');
        expect(note, path).toBeTruthy();
      } else {
        expect(section07Links, path).toContain(source.url);
      }
    }
  });

  it('names the limits §07 gives no link for, so a new one is a deliberate change', () => {
    const unlinked = limits(networks, 'networks')
      .filter(([, { source }]) => source.url === null)
      .map(([path]) => path);
    expect(unlinked).toEqual([
      'networks.facebook.caption',
      'networks.linkedin.caption',
      'networks.x.altText',
      'networks.threads.hashtags',
    ]);
  });

  describe('the details §07 calls out', () => {
    it('X: 280 weighted characters (emoji and CJK 2, URLs 23, Bangla 1) and 4 images', () => {
      expect(networks.x.caption.max).toBe(280);
      expect(networks.x.caption.counting).toBe('weighted');
      expect(networks.x.caption.source.url).toBe(
        'https://docs.x.com/fundamentals/counting-characters',
      );
      expect(networks.x.imagesPerPost.max).toBe(4);
      expect(networks.x.carousel.max).toBe(4);
    });

    it('Instagram: 5 hashtags, JPEG only, 20 @-tags, no alt text on stories', () => {
      expect(networks.instagram.hashtags?.max).toBe(5);
      expect(networks.instagram.hashtags?.source.url).toBe(
        'https://betanews.com/2025/12/19/instagram-puts-a-limit-on-hashtag-usage',
      );
      expect(networks.instagram.file.formats).toEqual(['jpeg']);
      expect(networks.instagram.mentions?.max).toBe(20);
      expect(networks.instagram.altText).toMatchObject({ notFor: ['story'] });
    });

    it('Pinterest: carousel up to 5, title 100, no alt text on carousels', () => {
      expect(networks.pinterest.carousel.max).toBe(5);
      expect(networks.pinterest.title?.max).toBe(100);
      expect(networks.pinterest.altText).toMatchObject({ notFor: ['carousel'] });
    });

    it('TikTok: a title of 90 and a description of 4,000, both in UTF-16 units', () => {
      expect(networks.tiktok.title).toMatchObject({ max: 90, counting: 'utf16' });
      expect(networks.tiktok.caption).toMatchObject({ max: 4_000, counting: 'utf16' });
    });

    it('Threads: more than 5 links fails', () => {
      expect(networks.threads.links?.max).toBe(5);
    });

    it('LinkedIn: carousels go out as a PDF document of up to 300 pages and 100 MB', () => {
      expect(networks.linkedin.carousel.as).toBe('pdf');
      expect(networks.linkedin.document).toMatchObject({
        maxPages: 300,
        maxMb: 100,
        source: { kind: 'O' },
      });
    });
  });

  it('passes its own schema', () => {
    expect(networksConfigSchema.safeParse({ sizes, networks }).success).toBe(true);
  });

  describe('the schema refuses', () => {
    it('a size whose pixels do not match its ratio', () => {
      const config = valid();
      config.sizes.portrait.height = 1080;
      expect(networksConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a default size that is not one of the 5', () => {
      const config = valid();
      Object.assign(config.networks.x.sizes, { single: 'banner' });
      expect(networksConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a limit without a source or a date', () => {
      const withoutSource = valid();
      Reflect.deleteProperty(withoutSource.networks.instagram.caption, 'source');
      expect(networksConfigSchema.safeParse(withoutSource).success).toBe(false);
      const withoutDate = valid();
      Reflect.deleteProperty(withoutDate.networks.instagram.caption.source, 'checked');
      expect(networksConfigSchema.safeParse(withoutDate).success).toBe(false);
    });

    it('an official source without a link, or a link-less source without a note', () => {
      const official = valid();
      official.networks.tiktok.caption.source.url = null;
      expect(networksConfigSchema.safeParse(official).success).toBe(false);
      const unexplained = valid();
      Reflect.deleteProperty(unexplained.networks.facebook.caption, 'note');
      expect(networksConfigSchema.safeParse(unexplained).success).toBe(false);
    });

    it('a link that is not https', () => {
      const config = valid();
      config.networks.x.caption.source.url = 'http://docs.x.com/fundamentals/counting-characters';
      expect(networksConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a carousel cap above the network limit', () => {
      const config = valid();
      config.networks.pinterest.carousel.max = 6;
      expect(networksConfigSchema.safeParse(config).success).toBe(false);
    });

    it('an unknown counting rule or file format', () => {
      const counting = valid();
      Object.assign(counting.networks.x.caption, { counting: 'words' });
      expect(networksConfigSchema.safeParse(counting).success).toBe(false);
      const format = valid();
      Object.assign(format.networks.instagram.file, { formats: ['heic'] });
      expect(networksConfigSchema.safeParse(format).success).toBe(false);
    });
  });
});
