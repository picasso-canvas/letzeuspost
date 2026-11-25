import { describe, expect, it } from 'vitest';
import { BrandKitSchema, CONFIDENCES, SOURCE_KINDS } from './kit.ts';
import { emptyKit, fullKit, item } from './test-fixtures.ts';

/** The kit with `path` (keys down the kit) set to `value`. */
function withAt(path: string[], value: unknown): unknown {
  const kit: Record<string, unknown> = structuredClone(fullKit());
  let at: Record<string, unknown> = kit;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path[path.length - 1] ?? ''] = value;
  return kit;
}

describe('BrandKitSchema', () => {
  it('holds the seven parts §06 lists, and nothing else', () => {
    expect(Object.keys(BrandKitSchema.shape)).toEqual([
      'identity',
      'voice',
      'facts',
      'look',
      'rules',
      'publishing',
      'holidays',
    ]);
  });

  it('accepts a kit with every part filled', () => {
    expect(BrandKitSchema.safeParse(fullKit()).success).toBe(true);
  });

  it('accepts a kit that is still empty: the five essentials come later', () => {
    expect(BrandKitSchema.safeParse(emptyKit()).success).toBe(true);
  });

  it('is strict: an unknown part, section field or item field is refused', () => {
    expect(BrandKitSchema.safeParse({ ...emptyKit(), extra: {} }).success).toBe(false);
    expect(BrandKitSchema.safeParse(withAt(['voice', 'slogan'], item('hi'))).success).toBe(false);
    expect(
      BrandKitSchema.safeParse(withAt(['identity', 'name'], { ...item('Golpo'), extra: 1 }))
        .success,
    ).toBe(false);
  });

  describe('every item says where it came from and how sure it is', () => {
    it('knows the five sources and the three confidences', () => {
      expect(SOURCE_KINDS).toEqual(['file', 'answer', 'typed', 'client-said', 'website']);
      expect(CONFIDENCES).toEqual(['found', 'guessed', 'needs-you']);
    });

    it.each(SOURCE_KINDS)('takes the source %s', (source) => {
      expect(
        BrandKitSchema.safeParse(withAt(['identity', 'name'], item('Golpo', { source }))).success,
      ).toBe(true);
    });

    it.each(CONFIDENCES)('takes the confidence %s', (confidence) => {
      expect(
        BrandKitSchema.safeParse(withAt(['identity', 'name'], item('Golpo', { confidence })))
          .success,
      ).toBe(true);
    });

    it.each([
      ['a source that is not one of the five', item('Golpo', { source: 'guess' })],
      ['a confidence that is not one of the three', item('Golpo', { confidence: 'sure' })],
      ['a time that is not UTC ISO', item('Golpo', { at: '20 Nov 2026' })],
      ['a time with no zone', item('Golpo', { at: '2026-11-20T09:30:00' })],
    ])('refuses %s', (_what, bad) => {
      expect(BrandKitSchema.safeParse(withAt(['identity', 'name'], bad)).success).toBe(false);
    });

    it.each(['source', 'ref', 'at', 'confidence', 'value'])('refuses an item with no %s', (key) => {
      const { [key]: _gone, ...rest } = item('Golpo');
      expect(BrandKitSchema.safeParse(withAt(['identity', 'name'], rest)).success).toBe(false);
    });

    it('wants it on items inside lists and groups too', () => {
      expect(BrandKitSchema.safeParse(withAt(['voice', 'toneWords'], ['warm'])).success).toBe(
        false,
      );
      expect(
        BrandKitSchema.safeParse(withAt(['identity', 'colors', 'primary'], '#8b2e16')).success,
      ).toBe(false);
    });

    it('takes a reference to a page, a file or a question, or none', () => {
      const page = item('Golpo', { source: 'website', ref: 'https://golpo.example/about' });
      expect(BrandKitSchema.safeParse(withAt(['identity', 'name'], page)).success).toBe(true);
      expect(
        BrandKitSchema.safeParse(withAt(['identity', 'name'], item('Golpo', { ref: null })))
          .success,
      ).toBe(true);
    });
  });

  describe('Facts', () => {
    const price = (over: Record<string, unknown> = {}) =>
      item({ what: 'Bhapa pitha', price: '৳60', checkedOn: '2026-11-18', ...over });

    it('takes a price with the date it was checked', () => {
      expect(BrandKitSchema.safeParse(withAt(['facts', 'prices'], [price()])).success).toBe(true);
    });

    it('needs the checked-on date on a price', () => {
      const { checkedOn: _gone, ...noDate } = { what: 'Bhapa pitha', price: '৳60', checkedOn: '' };
      expect(BrandKitSchema.safeParse(withAt(['facts', 'prices'], [item(noDate)])).success).toBe(
        false,
      );
    });

    it.each(['18 Nov 2026', '2026-11-31', '2026-13-01', '', '2026-11-18T00:00:00Z'])(
      'refuses the checked-on date %j: a calendar day, YYYY-MM-DD',
      (checkedOn) => {
        expect(
          BrandKitSchema.safeParse(withAt(['facts', 'prices'], [price({ checkedOn })])).success,
        ).toBe(false);
      },
    );
  });

  describe('the other parts keep their limits', () => {
    const ok = (path: string[], value: unknown) =>
      BrandKitSchema.safeParse(withAt(path, value)).success;

    it('takes colours as six-digit hex only, as the renderer does', () => {
      expect(ok(['identity', 'colors', 'primary'], item('red'))).toBe(false);
      expect(ok(['identity', 'colors', 'primary'], item('#fff'))).toBe(false);
      expect(ok(['identity', 'colors', 'extras'], [item('#112233; x')])).toBe(false);
    });

    it('takes at most 8 extra colours, 3 tone words and 6 pillars', () => {
      expect(ok(['identity', 'colors', 'extras'], Array(9).fill(item('#112233')))).toBe(false);
      expect(ok(['voice', 'toneWords'], Array(4).fill(item('warm')))).toBe(false);
      expect(ok(['voice', 'pillars'], Array(7).fill(item('Pitha')))).toBe(false);
      expect(ok(['voice', 'pillars'], Array(6).fill(item('Pitha')))).toBe(true);
    });

    it('takes a logo as an asset key, never a web address, and never the temporary-wordmark key', () => {
      expect(ok(['identity', 'logo', 'light'], item('https://evil.example/x.png'))).toBe(false);
      expect(ok(['identity', 'logo', 'light'], item('temporary-wordmark'))).toBe(false);
    });

    it('takes the main language of a network, in English or Bangla', () => {
      expect(ok(['voice', 'mainLanguage'], { instagram: item('hi') })).toBe(false);
      expect(ok(['voice', 'mainLanguage'], { myspace: item('en') })).toBe(false);
    });

    it('takes the three approval modes of §11', () => {
      for (const mode of ['none', 'agency', 'agency-then-client'])
        expect(ok(['publishing', 'approvalMode'], item(mode))).toBe(true);
      expect(ok(['publishing', 'approvalMode'], item('client'))).toBe(false);
    });

    it('takes an IANA timezone and a two-letter country', () => {
      expect(ok(['publishing', 'timezone'], item('Asia/Dhaka'))).toBe(true);
      expect(ok(['publishing', 'timezone'], item('Dhaka time'))).toBe(false);
      expect(ok(['holidays', 'country'], item('Bangladesh'))).toBe(false);
      expect(ok(['holidays', 'country'], item('bd'))).toBe(false);
    });

    it('takes posting times as 24-hour HH:MM, and custom dates as MM-DD', () => {
      expect(ok(['publishing', 'postingTimes'], [item('24:00')])).toBe(false);
      expect(ok(['publishing', 'postingTimes'], [item('6pm')])).toBe(false);
      const custom = (monthDay: string) => [item({ name: 'Anniversary', monthDay })];
      expect(ok(['holidays', 'custom'], custom('02-29'))).toBe(true); // a leap-day anniversary
      expect(ok(['holidays', 'custom'], custom('02-30'))).toBe(false);
      expect(ok(['holidays', 'custom'], custom('04-31'))).toBe(false);
      expect(ok(['holidays', 'custom'], [item({ name: 'Anniversary', monthDay: '13-01' })])).toBe(
        false,
      );
    });

    it('refuses an item with no words in it, and takes Bangla text', () => {
      expect(ok(['identity', 'name'], item('   '))).toBe(false);
      expect(ok(['voice', 'writerNotes'], item('শীতের গল্প'))).toBe(true);
    });
  });
});
