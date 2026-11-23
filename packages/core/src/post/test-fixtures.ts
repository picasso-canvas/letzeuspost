// Valid sample content for the post tests: one slide per layout, and §07's Bangla carousel example.
import type { LayoutName } from './slide.ts';

/** The object without the given keys. */
export const omit = (object: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

export const image = { asset: 'ast_9f2', crop: [0, 120, 1080, 900], focus: 'center' };

export const slides: Record<LayoutName, Record<string, unknown>> = {
  cover: {
    layout: 'cover',
    kicker: 'শীতের গল্প',
    title: 'ফিরে এল *পিঠা* সপ্তাহ',
    alt: 'পিঠার থালা',
  },
  fact: {
    layout: 'fact',
    kicker: 'Did you know',
    title: 'Pitha is older than tea',
    body: 'Rice cakes were made here for centuries.',
    source: 'Bangla Academy, 2019',
    alt: 'A plate of pitha',
  },
  step: {
    layout: 'step',
    n: 1,
    of: 3,
    image,
    title: 'Soak the rice',
    body: 'Leave it overnight.',
    alt: 'Rice in water',
  },
  list: {
    layout: 'list',
    title: 'Winter treats',
    items: ['Bhapa pitha', 'Patishapta', 'Khejur gur'],
    alt: 'A list of winter treats',
  },
  quote: {
    layout: 'quote',
    quote: 'We cook what our grandmothers cooked.',
    person: 'Rahim',
    role: 'Head cook',
    public: false,
    alt: 'A quote from the head cook',
  },
  stat: {
    layout: 'stat',
    number: '3,000',
    label: 'pitha sold last winter',
    source: 'Our till records',
    alt: 'The number 3,000',
  },
  question: {
    layout: 'question',
    kicker: 'Tell us',
    question: 'Which pitha is your favourite?',
    options: [{ text: 'Bhapa' }, { text: 'Patishapta' }],
    alt: 'A question with two options',
  },
  offer: {
    layout: 'offer',
    badge: 'New',
    title: 'Pitha week',
    details: 'Every pitha 20% off from 14 December.',
    cta: 'Order today',
    alt: 'An offer for pitha week',
  },
  cta: {
    layout: 'cta',
    mark: 'logo',
    title: 'Come and taste',
    body: 'We are open every day.',
    cta: 'Visit us',
    alt: 'The cafe logo',
  },
  text: {
    layout: 'text',
    kicker: 'Note',
    title: 'We close early',
    body: 'On Friday at 5.',
    alt: 'A note',
  },
  testimonial: {
    layout: 'testimonial',
    quote: 'Best pitha in town.',
    customer: 'Nadia',
    detail: 'Regular since 2022',
    alt: 'A customer quote',
  },
  photocard: {
    layout: 'photocard',
    photo: image,
    headline: 'Pitha week returns',
    fact: 'It runs for seven days.',
    source: 'Cafe announcement',
    photoCredit: 'Photo: the cafe',
    alt: 'A photo of pitha',
  },
  meme: {
    layout: 'meme',
    panels: [{ image, label: 'Monday' }],
    text: 'Me before pitha',
    alt: 'A one-panel joke',
  },
  beforeafter: {
    layout: 'beforeafter',
    before: image,
    after: image,
    beforeLabel: 'Before',
    afterLabel: 'After',
    caption: 'Our new counter',
    alt: 'The counter before and after',
  },
};

/** §07's Bangla carousel example, with a second slide so it is a valid carousel. */
export const banglaCarousel = {
  brand: 'golpo',
  lang: 'bn',
  linkedTo: 'post_123_en',
  kind: 'carousel',
  networks: ['instagram', 'facebook'],
  date: '2026-12-14T12:30:00+06:00',
  look: { name: 'playful', switches: { corners: 'round', frame: 'print', highlight: 'pill' } },
  slides: [
    {
      layout: 'cover',
      kicker: 'শীতের গল্প',
      title: 'ফিরে এল *পিঠা* সপ্তাহ',
      image,
      alt: '…',
    },
    slides.cta,
  ],
  captions: {
    instagram: { text: '…', hashtags: ['#গল্পক্যাফে'] },
    facebook: { text: '…' },
  },
  sources: [],
  credits: [],
  flags: { aiImage: false, claimsConfirmed: null, testimonialConsent: null },
};
