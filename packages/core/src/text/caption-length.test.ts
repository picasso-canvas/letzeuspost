import { describe, expect, it } from 'vitest';
import { captionLength, fitsCaption, NETWORKS, type Network } from './caption-length.ts';

const FAMILY = '👨‍👩‍👧';
const FLAG = '🇧🇩';
const LONG_URL = 'https://example.com/a/very/long/path/that/goes/on?x=1&y=2';

describe('captionLength: every network', () => {
  it.each(NETWORKS)('counts an empty caption as 0 on %s', (network) => {
    expect(captionLength(network, '')).toBe(0);
  });

  it.each(NETWORKS)('counts plain English letters one each on %s', (network) => {
    expect(captionLength(network, 'Fresh pitha today')).toBe(17);
  });
});

describe('captionLength: X (weighted)', () => {
  it('counts English letters as 1 each', () => {
    expect(captionLength('x', 'hello')).toBe(5);
  });

  it('counts an emoji as 2', () => {
    expect(captionLength('x', 'Hello 👍')).toBe(8);
  });

  it('counts a ZWJ family, a flag and a keycap emoji as 2 each', () => {
    expect(captionLength('x', FAMILY)).toBe(2);
    expect(captionLength('x', FLAG)).toBe(2);
    expect(captionLength('x', '1️⃣')).toBe(2);
  });

  it('counts CJK characters as 2 each', () => {
    expect(captionLength('x', '日本語')).toBe(6);
  });

  it('counts Bangla as 1 per character, so a conjunct ক্ষ is 3', () => {
    expect(captionLength('x', 'ক্ষ')).toBe(3);
    expect(captionLength('x', 'বাংলা')).toBe(5);
  });

  it('counts any URL as 23, however long or short', () => {
    expect(captionLength('x', LONG_URL)).toBe(23);
    expect(captionLength('x', 'http://a.co')).toBe(23);
  });

  it('counts the text around a URL normally', () => {
    expect(captionLength('x', `see ${LONG_URL} now`)).toBe(4 + 23 + 4);
  });

  it('does not count trailing punctuation, including the Bangla danda, as part of a URL', () => {
    expect(captionLength('x', `${LONG_URL}.`)).toBe(24);
    expect(captionLength('x', 'https://example.com।')).toBe(24);
  });

  it('counts two URLs as 46', () => {
    expect(captionLength('x', `${LONG_URL} https://example.org/x`)).toBe(23 + 1 + 23);
  });

  // The rule: a counter may count more than X does, never less. So anything that could be a link counts as one
  // (23), and only a word that clearly can't be (no letters-only ending of 2+ characters: v1.2, e.g., 3.5) stays text.
  it('counts a bare domain as 23, like any link', () => {
    expect(captionLength('x', 'example.com')).toBe(23);
    expect(captionLength('x', 'a.co')).toBe(23);
    expect(captionLength('x', 'site.co.uk/path')).toBe(23);
    expect(captionLength('x', 'www.example.com/a/very/long/path/that/goes/on?x=1')).toBe(23);
  });

  it('counts the text around a bare domain normally, and its closing punctuation outside', () => {
    expect(captionLength('x', 'Visit example.com today')).toBe(6 + 23 + 6);
    expect(captionLength('x', 'Visit example.com.')).toBe(6 + 23 + 1);
    expect(captionLength('x', '(see site.co.uk/path)')).toBe(5 + 23 + 1);
  });

  it('counts a bare domain in a Bangla caption as 23, and the danda after it as 1', () => {
    expect(captionLength('x', 'বাংলা example.com।')).toBe(5 + 1 + 23 + 1);
    expect(captionLength('x', 'বাংলা.com')).toBe(23);
    expect(captionLength('x', 'দেখুন site.co.uk/path')).toBe(5 + 1 + 23);
  });

  it('counts a bare domain in capitals as 23 too', () => {
    expect(captionLength('x', 'EXAMPLE.COM')).toBe(23);
  });

  it('leaves a word that is clearly not a link as text', () => {
    expect(captionLength('x', 'v1.2')).toBe(4);
    expect(captionLength('x', 'Costs 3.5 each, e.g. two')).toBe(24);
    expect(captionLength('x', 'U.S.A')).toBe(5);
    expect(captionLength('x', 'আজ ৩.৫ টাকা')).toBe(11);
  });

  it('keeps a ) that closes a ( inside a URL as part of the link', () => {
    const wiki = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(captionLength('x', wiki)).toBe(23);
    expect(captionLength('x', `${wiki}.`)).toBe(24);
    expect(captionLength('x', `(see ${wiki})`)).toBe(1 + 4 + 23 + 1);
    expect(captionLength('x', 'en.wikipedia.org/wiki/Foo_(bar)')).toBe(23);
  });

  it('still drops a ) that closes a ( outside the link', () => {
    expect(captionLength('x', '(see https://example.com/a)')).toBe(5 + 23 + 1);
    expect(captionLength('x', '(see https://example.com/a).')).toBe(5 + 23 + 2);
    expect(captionLength('x', 'https://example.com/a))')).toBe(23 + 2);
  });

  it('counts two http(s) links with only punctuation between them as two links', () => {
    expect(captionLength('x', 'https://a.com,https://b.com')).toBe(23 + 1 + 23);
    expect(captionLength('x', 'http://a.com/x).https://b.com/y')).toBe(23 + 2 + 23);
    expect(captionLength('x', 'example.com/a,https://b.com')).toBe(23 + 1 + 23);
    expect(captionLength('x', 'https://a.com।https://b.com।')).toBe(23 + 1 + 23 + 1);
  });

  it('starts a link only at a word start', () => {
    expect(captionLength('x', 'x-example.com')).toBe(23);
    expect(captionLength('x', 'a'.repeat(64))).toBe(64);
    expect(captionLength('x', 'v1.2.3')).toBe(6);
  });

  it('counts a label of up to 63 characters as a domain, and a longer one as text', () => {
    expect(captionLength('x', `${'a'.repeat(63)}.com`)).toBe(23);
    expect(captionLength('x', `${'a'.repeat(64)}.com`)).toBe(68);
    expect(captionLength('x', `a.${'b'.repeat(64)}.com`)).toBe(2 + 64 + 4);
  });

  it('counts a domain of up to 253 characters as a link, and a longer one as text', () => {
    // Three 63-character labels and dots (192), then a last label: 253 characters in all.
    const label = 'a'.repeat(63);
    const domain253 = `${label}.${label}.${label}.${'b'.repeat(57)}.com`;
    expect(domain253).toHaveLength(253);
    expect(captionLength('x', domain253)).toBe(23);
    expect(captionLength('x', `${domain253}.`)).toBe(24);
    const domain259 = `${label}.${label}.${label}.${label}.com`;
    expect(domain259).toHaveLength(259);
    expect(captionLength('x', domain259)).toBeGreaterThan(23);
  });

  it('does not count a domain of 254 or 255 characters as one link, with 253 and 253 + a period still one', () => {
    const label = 'a'.repeat(63);
    const domain = (last: number) => `${label}.${label}.${label}.${'b'.repeat(last)}.com`;
    expect(domain(57)).toHaveLength(253);
    expect(captionLength('x', domain(57))).toBe(23);
    expect(captionLength('x', `${domain(57)}.`)).toBe(24);
    expect(domain(58)).toHaveLength(254);
    expect(captionLength('x', domain(58))).toBeGreaterThan(23);
    expect(captionLength('x', `${domain(58)}.`)).toBeGreaterThan(24);
    expect(domain(59)).toHaveLength(255);
    expect(captionLength('x', domain(59))).toBeGreaterThan(23);
  });

  it('counts a bare domain inside text written without spaces as a link, and the text around it normally', () => {
    expect(captionLength('x', '请访问example.com了解更多')).toBe(6 + 23 + 8);
    expect(captionLength('x', 'ดูที่example.comเลย')).toBe(5 + 23 + 3);
    // A link with a scheme runs to the next space, the way X reads it.
    expect(captionLength('x', '请访问https://example.com了解更多')).toBe(6 + 23);
    expect(captionLength('x', 'বাংলাexample.com')).toBe(5 + 23);
    expect(captionLength('x', 'example.com了解更多')).toBe(23 + 8);
  });

  it('keeps a domain in a script other than Latin, and a mixed-script one, as at least a link', () => {
    expect(captionLength('x', 'example.中国')).toBe(23);
    expect(captionLength('x', 'bücher.de')).toBeGreaterThanOrEqual(23);
  });

  it('fits 280 letters and refuses 281', () => {
    expect(fitsCaption('x', 'a'.repeat(280), 280)).toBe(true);
    expect(fitsCaption('x', 'a'.repeat(281), 280)).toBe(false);
  });

  it('fits 140 emoji and refuses 141 (each is 2)', () => {
    expect(fitsCaption('x', '👍'.repeat(140), 280)).toBe(true);
    expect(fitsCaption('x', '👍'.repeat(141), 280)).toBe(false);
  });

  it('fits 280 Bangla letters and refuses 281', () => {
    expect(fitsCaption('x', 'ক'.repeat(280), 280)).toBe(true);
    expect(fitsCaption('x', 'ক'.repeat(281), 280)).toBe(false);
  });
});

describe('captionLength: TikTok (UTF-16 units)', () => {
  it('counts English letters as 1 each', () => {
    expect(captionLength('tiktok', 'hello')).toBe(5);
  });

  it('counts an emoji outside the BMP as 2 units', () => {
    expect(captionLength('tiktok', '👍')).toBe(2);
  });

  it('counts a flag as 4 and a ZWJ family as 8', () => {
    expect(captionLength('tiktok', FLAG)).toBe(4);
    expect(captionLength('tiktok', FAMILY)).toBe(8);
  });

  it('counts every Bangla code point, so ক্ষ is 3', () => {
    expect(captionLength('tiktok', 'ক্ষ')).toBe(3);
  });

  it('counts a URL by its characters', () => {
    expect(captionLength('tiktok', 'https://a.co/x')).toBe(14);
  });

  it('fits a 90-unit title and refuses 91', () => {
    expect(fitsCaption('tiktok', 'a'.repeat(90), 90)).toBe(true);
    expect(fitsCaption('tiktok', 'a'.repeat(91), 90)).toBe(false);
  });

  it('fits a 4,000-unit description with 2,000 emoji and refuses 2,001', () => {
    expect(fitsCaption('tiktok', '👍'.repeat(2000), 4000)).toBe(true);
    expect(fitsCaption('tiktok', '👍'.repeat(2001), 4000)).toBe(false);
  });
});

describe('captionLength: Threads (emoji by byte length)', () => {
  it('counts English letters as 1 each', () => {
    expect(captionLength('threads', 'hello')).toBe(5);
  });

  it('counts an emoji as its UTF-8 byte length', () => {
    expect(captionLength('threads', '👍')).toBe(4);
    expect(captionLength('threads', 'hello 👍')).toBe(6 + 4);
  });

  it('counts a heart with a variation selector as 6 bytes', () => {
    expect(captionLength('threads', '❤️')).toBe(6);
  });

  it('counts a flag as 8 bytes and a ZWJ family as 18', () => {
    expect(captionLength('threads', FLAG)).toBe(8);
    expect(captionLength('threads', FAMILY)).toBe(18);
  });

  it('counts Bangla by grapheme, so ক্ষ is 1 and বাংলা is 2', () => {
    expect(captionLength('threads', 'ক্ষ')).toBe(1);
    expect(captionLength('threads', 'বাংলা')).toBe(2);
  });

  it('does not shorten a URL', () => {
    expect(captionLength('threads', 'https://a.co/x')).toBe(14);
  });

  it('fits 500 letters and refuses 501', () => {
    expect(fitsCaption('threads', 'a'.repeat(500), 500)).toBe(true);
    expect(fitsCaption('threads', 'a'.repeat(501), 500)).toBe(false);
  });

  it('fits 125 emoji (500 bytes) and refuses 126', () => {
    expect(fitsCaption('threads', '👍'.repeat(125), 500)).toBe(true);
    expect(fitsCaption('threads', '👍'.repeat(126), 500)).toBe(false);
  });

  it('fits 500 Bangla conjuncts and refuses 501', () => {
    expect(fitsCaption('threads', 'ক্ষ'.repeat(500), 500)).toBe(true);
    expect(fitsCaption('threads', 'ক্ষ'.repeat(501), 500)).toBe(false);
  });
});

describe('captionLength: the other networks (plain characters)', () => {
  const plain: Network[] = ['instagram', 'facebook', 'linkedin', 'pinterest'];

  it.each(plain)('counts the Bangla conjunct ক্ষ as 1 on %s', (network) => {
    expect(captionLength(network, 'ক্ষ')).toBe(1);
    expect(captionLength(network, 'বাংলাদেশ')).toBe(4);
  });

  it.each(plain)('counts any emoji, even a ZWJ family, as 1 on %s', (network) => {
    expect(captionLength(network, FAMILY)).toBe(1);
    expect(captionLength(network, '👍🏽')).toBe(1);
  });

  it.each(plain)('counts a URL by its characters on %s', (network) => {
    expect(captionLength(network, 'https://a.co/x')).toBe(14);
  });

  it('fits 2,200 Instagram characters and refuses 2,201', () => {
    expect(fitsCaption('instagram', 'ক্ষ'.repeat(2200), 2200)).toBe(true);
    expect(fitsCaption('instagram', 'ক্ষ'.repeat(2201), 2200)).toBe(false);
  });

  it('fits a 100-character Pinterest title and refuses 101', () => {
    expect(fitsCaption('pinterest', 'a'.repeat(100), 100)).toBe(true);
    expect(fitsCaption('pinterest', 'a'.repeat(101), 100)).toBe(false);
  });

  it('fits 3,000 LinkedIn characters and refuses 3,001', () => {
    expect(fitsCaption('linkedin', '👍'.repeat(3000), 3000)).toBe(true);
    expect(fitsCaption('linkedin', '👍'.repeat(3001), 3000)).toBe(false);
  });

  it('fits 63,206 Facebook characters and refuses one more', () => {
    expect(fitsCaption('facebook', 'a'.repeat(63_206), 63_206)).toBe(true);
    expect(fitsCaption('facebook', 'a'.repeat(63_207), 63_206)).toBe(false);
  });
});

// A caption can be up to 63,206 characters (Facebook), and the counter runs in the web and worker processes, so no
// input may take more than linear time (the first version took about 10^9 steps on these).
describe('captionLength: hostile input stays linear', () => {
  const LIMIT_MS = 1000;
  const hostile: [string, string][] = [
    ['a 100,000-character word with no dot', 'a'.repeat(100_000)],
    ['a1. repeated to 100,000 characters', 'a1.'.repeat(33_334).slice(0, 100_000)],
    ['a. repeated to 100,000 characters', 'a.'.repeat(50_000)],
    ['a link ending in 50,000 )', `https://example.com/a${')'.repeat(50_000)}`],
    ['a link ending in 25,000 ()', `https://example.com/a${'()'.repeat(25_000)}`],
    ['http:// repeated to 100,000 characters', 'http://'.repeat(14_286).slice(0, 100_000)],
    ['a chain of comma-separated links', 'https://a.com,'.repeat(7_143).slice(0, 100_000)],
    ['ASCII and Bangla letters alternating', 'aক'.repeat(50_000)],
    ['ASCII and Bangla labels alternating between dots', 'a.ক.'.repeat(25_000)],
    ['Chinese text with a dotted ASCII letter after each character', '请a.'.repeat(33_333)],
    ['61-character labels and dots, past the domain cap', `${'a'.repeat(60)}.`.repeat(1_600)],
  ];

  describe.each(hostile)('%s', (_name, text) => {
    it.each(NETWORKS)('is counted within the limit on %s', (network) => {
      const start = performance.now();
      captionLength(network, text);
      expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    });
  });
});
