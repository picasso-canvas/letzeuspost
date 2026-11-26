// Northwind Social's 3 sample brands (#411, §17 Test data, §21, §05's mockups): Golpo Café (Dhaka, Playful, English and
// Bangla), Ironline Studio (Austin, Bold) and Brightwell Dental (Leeds, Clean), with the colours and fonts of
// docs/design/logos and the voice, facts and rules of the approved mockups (docs/design/mockups/v1). Full kits, as an
// agency would save them, each item with its source (§06). Fictional: web addresses are on `.example` and email
// addresses on `.invalid`, which reach no one.
//
// No logo, mark or mascot yet: those are stored assets, which need the file store and come in a follow-up task. Until
// then `toRenderKit` gives the renderer the temporary wordmark (§06 Missing pieces). A font the renderer doesn't have yet
// (Anton and Manrope come with the Bold look, §08) is kept in the kit; `toRenderKit` gives the renderer the look's
// default instead.
import type { BrandKit, Confidence, SourceKind } from '../../../core/src/index.ts';

/** A sample brand: its names and its kit, as the agency would save it. */
export interface SampleBrand {
  readonly nameEn: string;
  readonly nameBn?: string;
  readonly kit: BrandKit;
}

/** When every sample item was recorded: fixed, so each run saves the same kit. */
const AT = '2026-11-26T09:00:00.000Z';

/** One kit item: its value, where it came from (typed by the agency unless said otherwise) and how sure it is. */
function item<const T>(
  value: T,
  from: { source?: SourceKind; ref?: string; confidence?: Confidence } = {},
) {
  return {
    value,
    source: from.source ?? 'typed',
    ref: from.ref ?? null,
    at: AT,
    confidence: from.confidence ?? 'found',
  };
}

function golpoCafe(): BrandKit {
  const site = (page: string) =>
    ({ source: 'website', ref: `https://golpo.example/${page}` }) as const;
  const owner = { source: 'client-said', ref: 'Rafiq, on the kickoff call' } as const;
  return {
    identity: {
      name: item('Golpo Café'),
      nameBn: item('গল্প ক্যাফে'),
      shortName: item('Golpo'),
      colors: {
        primary: item('#1F5C45', site('')),
        accent: item('#FFB627', site('')),
        background: item('#FFF1D6', { source: 'answer', ref: 'colors you like' }),
        ink: item('#1F3A2E', site('')),
      },
      fonts: {
        en: { heading: item('Baloo 2'), body: item('Nunito') },
        bn: { heading: item('Baloo Da 2'), body: item('Hind Siliguri') },
      },
    },
    voice: {
      toneWords: [item('Warm'), item('Neighbourly'), item('A little playful')],
      audience: item(
        'Dhanmondi regulars, students and young families; Bangla first on Facebook, English on Instagram',
        { source: 'answer', ref: 'who their customers are' },
      ),
      pillars: [
        item('Seasonal food'),
        item('People of Golpo'),
        item('Community questions'),
        item('Everyday cha'),
      ],
      wordsToUse: [
        item('our street'),
        item('regulars'),
        item('fresh every morning'),
        item('আড্ডা'),
      ],
      wordsToAvoid: [item('cheap'), item('best in Dhaka'), item('limited time only')],
      callsToAction: [item('Come hungry.'), item('চলে আসুন।'), item('Tell us in the comments.')],
      hashtags: [item('#GolpoCafe'), item('#গল্পক্যাফে'), item('#DhakaFood')],
      examplePosts: [
        item('শীতের সকালে গরম ভাপা পিঠা আর এক কাপ চা। আজই চলে আসুন।', {
          source: 'file',
          ref: 'upload:post-1.png',
        }),
        item('Rainy afternoon? Your usual table and a hot cup of cha are waiting.', {
          source: 'file',
          ref: 'upload:post-2.png',
        }),
      ],
      mainLanguage: { facebook: item('bn'), instagram: item('en') },
      writerNotes: item(
        'Bangla is written natively, never translated. Prices in taka, written as “1,200 taka” in English and “১,২০০ টাকা” in Bangla.',
      ),
    },
    facts: {
      sells: [item('Tea, pitha and snacks', site('menu'))],
      prices: [
        item(
          { what: 'Bhapa pitha', price: '40 taka', checkedOn: '2026-11-01' },
          { source: 'file', ref: 'upload:menu.pdf' },
        ),
      ],
      openingHours: item('8 am to 11 pm, every day', site('contact')),
      locations: [item('Road 27, Dhanmondi, Dhaka', site('contact'))],
      contacts: [item('golpo.example')],
      founded: item('March 2022', owner),
      different: [item('Pitha made fresh every morning, on the spot', owner)],
    },
    look: { look: item({ name: 'playful', switches: { corners: 'round' } }) },
    rules: {
      claimsToAvoid: [item('Health benefits of food or tea'), item('“Organic” (not certified)')],
      restrictedIndustry: item(false),
      topicsToSkip: [item('Politics'), item('Competitors')],
      memes: item(false),
    },
    publishing: {
      accounts: [
        item({ network: 'facebook', handle: 'golpocafe' }),
        item({ network: 'instagram', handle: 'golpocafe' }),
      ],
      sizes: { facebook: item('portrait'), instagram: item('portrait') },
      timezone: item('Asia/Dhaka'),
      postingTimes: [item('12:30'), item('17:30')],
      approvalMode: item('agency-then-client'),
      reviewers: [item({ name: 'Rafiq Ahmed', email: 'rafiq@golpo.invalid' })],
    },
    holidays: {
      country: item('BD', { source: 'answer', ref: 'city and country' }),
      switches: [
        item({ holiday: 'bd-language-martyrs-day', on: true }),
        item({ holiday: 'bd-pohela-boishakh', on: true }),
        item({ holiday: 'bd-victory-day', on: true }),
        item({ holiday: 'christmas-day', on: true }),
        item({ holiday: 'new-years-eve', on: true }),
      ],
      custom: [item({ name: 'Golpo’s birthday', monthDay: '03-03' }, owner)],
    },
  };
}

function ironlineStudio(): BrandKit {
  const site = (page: string) =>
    ({ source: 'website', ref: `https://ironline.example/${page}` }) as const;
  const guide = { source: 'file', ref: 'upload:brand-guide.pdf' } as const;
  return {
    identity: {
      name: item('Ironline Studio'),
      shortName: item('Ironline'),
      colors: {
        primary: item('#121212', guide),
        accent: item('#FF4D2E', guide),
        background: item('#FFFFFF', guide),
        ink: item('#121212', guide),
        // The accent, darkened for small text on white.
        extras: [item('#C9381E', guide)],
      },
      fonts: { en: { heading: item('Anton', guide) } },
    },
    voice: {
      toneWords: [item('Direct'), item('Motivating'), item('No-nonsense')],
      audience: item(
        'Busy Austin professionals, 25 to 45, who want short, hard workouts before or after work',
        { source: 'answer', ref: 'who their customers are' },
      ),
      pillars: [
        item('Workout of the week'),
        item('Member stories'),
        item('Coach tips'),
        item('Studio news'),
      ],
      wordsToUse: [item('show up'), item('every level'), item('reps')],
      wordsToAvoid: [item('beach body'), item('no pain, no gain'), item('skinny')],
      callsToAction: [item('Book your first class free.'), item('Tag your workout partner.')],
      hashtags: [item('#IronlineStudio'), item('#AustinFitness'), item('#EMOM')],
      examplePosts: [
        item('No excuses Tuesday: 20 minutes, 5 moves, every minute on the minute. Who’s in?', {
          source: 'file',
          ref: 'upload:post-1.png',
        }),
      ],
      mainLanguage: { instagram: item('en'), tiktok: item('en') },
      writerNotes: item('Short sentences. Headlines in capitals are fine; captions are not.'),
    },
    facts: {
      sells: [item('Small-group strength and conditioning classes', site(''))],
      prices: [
        item({ what: 'First class', price: 'Free', checkedOn: '2026-11-02' }, site('pricing')),
        item(
          { what: 'Monthly membership', price: '$149', checkedOn: '2026-11-02' },
          site('pricing'),
        ),
      ],
      openingHours: item('Mon to Fri 5:30 am to 8 pm, Sat 7 am to noon', site('contact')),
      locations: [item('East Austin, Texas', site('contact'))],
      contacts: [item('ironline.example')],
      founded: item('2018', site('about')),
      different: [
        item('Classes capped at 12 people', site('about')),
        item('A coach on the floor for every class', site('about')),
      ],
    },
    look: { look: item({ name: 'bold', switches: { corners: 'sharp' } }) },
    rules: {
      claimsToAvoid: [item('Weight-loss promises'), item('Medical or injury advice')],
      requiredLines: [item('Check with your doctor before starting a new exercise program.')],
      restrictedIndustry: item(false),
      topicsToSkip: [item('Diet culture'), item('Politics')],
      memes: item(false),
    },
    publishing: {
      accounts: [
        item({ network: 'instagram', handle: 'ironlinestudio' }),
        item({ network: 'tiktok', handle: 'ironlinestudio' }),
      ],
      sizes: { instagram: item('portrait'), tiktok: item('story') },
      timezone: item('America/Chicago'),
      postingTimes: [item('06:00'), item('17:00')],
      approvalMode: item('agency'),
    },
    holidays: {
      country: item('US', { source: 'answer', ref: 'city and country' }),
      switches: [
        item({ holiday: 'us-independence-day', on: true }),
        item({ holiday: 'us-thanksgiving', on: true }),
        item({ holiday: 'christmas-day', on: true }),
      ],
      custom: [item({ name: 'Ironline anniversary', monthDay: '09-15' })],
    },
  };
}

function brightwellDental(): BrandKit {
  const site = (page: string) =>
    ({ source: 'website', ref: `https://brightwell.example/${page}` }) as const;
  const practice = { source: 'client-said', ref: 'Dr Emma Hart, on the kickoff call' } as const;
  return {
    identity: {
      name: item('Brightwell Dental'),
      shortName: item('Brightwell'),
      colors: {
        primary: item('#0F766E', site('')),
        accent: item('#CCF0EA', site('')),
        background: item('#F0FAF8', site('')),
        ink: item('#0F3D3A', site('')),
      },
      fonts: { en: { heading: item('Manrope', site('')), body: item('Manrope', site('')) } },
    },
    voice: {
      toneWords: [item('Calm'), item('Reassuring'), item('Clear')],
      audience: item(
        'Families and working adults in Leeds, many of them nervous about seeing a dentist',
        { source: 'answer', ref: 'who their customers are' },
      ),
      pillars: [
        item('Everyday care tips'),
        item('Meet the team'),
        item('Treatments explained'),
        item('Practice news'),
      ],
      wordsToUse: [item('gentle'), item('check-up'), item('your smile')],
      wordsToAvoid: [item('pain-free'), item('cheap'), item('perfect teeth')],
      callsToAction: [item('Book a check-up online.'), item('Call us to talk it through.')],
      hashtags: [item('#BrightwellDental'), item('#LeedsDentist')],
      examplePosts: [
        item('3 signs you’re brushing too hard, and what to do instead.', {
          source: 'file',
          ref: 'upload:post-1.png',
        }),
      ],
      mainLanguage: { facebook: item('en'), linkedin: item('en') },
      writerNotes: item('British spelling. Explain treatments simply; never promise results.'),
    },
    facts: {
      sells: [item('General, family and cosmetic dentistry', site('treatments'))],
      prices: [
        item({ what: 'New patient check-up', price: '£55', checkedOn: '2026-11-03' }, site('fees')),
        item({ what: 'Tooth whitening', price: '£295', checkedOn: '2026-11-03' }, site('fees')),
      ],
      openingHours: item('Mon to Fri 8 am to 6 pm, Sat 9 am to 1 pm', site('contact')),
      locations: [item('Headingley, Leeds', site('contact'))],
      contacts: [item('brightwell.example')],
      founded: item('2011', site('about')),
      different: [item('Longer appointments for nervous patients', practice)],
    },
    look: {
      look: item({ name: 'clean', switches: { corners: 'soft', highlight: 'underline' } }),
    },
    rules: {
      claimsToAvoid: [
        item('Pain-free treatment'),
        item('Guaranteed results'),
        item('Comparisons with other practices'),
      ],
      requiredLines: [item('Results vary from person to person.', practice)],
      restrictedIndustry: item(false),
      topicsToSkip: [item('Patients’ cases without their written consent'), item('Politics')],
      memes: item(false),
    },
    publishing: {
      accounts: [
        item({ network: 'facebook', handle: 'brightwelldental' }),
        item({ network: 'linkedin', handle: 'brightwell-dental' }),
      ],
      sizes: { facebook: item('portrait'), linkedin: item('square') },
      timezone: item('Europe/London'),
      postingTimes: [item('08:30'), item('12:00')],
      approvalMode: item('agency-then-client'),
      reviewers: [item({ name: 'Dr Emma Hart', email: 'emma.hart@brightwell.invalid' })],
    },
    holidays: {
      country: item('GB', { source: 'answer', ref: 'city and country' }),
      switches: [
        item({ holiday: 'gb-christmas-day', on: true }),
        item({ holiday: 'gb-boxing-day', on: true }),
        item({ holiday: 'gb-new-years-day', on: true }),
      ],
      custom: [item({ name: 'Brightwell anniversary', monthDay: '06-01' }, site('about'))],
    },
  };
}

/** The 3 sample brands, in the order the mockups list them; a fresh copy on every call. */
export function sampleBrands(): SampleBrand[] {
  return [
    { nameEn: 'Golpo Café', nameBn: 'গল্প ক্যাফে', kit: golpoCafe() },
    { nameEn: 'Ironline Studio', kit: ironlineStudio() },
    { nameEn: 'Brightwell Dental', kit: brightwellDental() },
  ];
}
