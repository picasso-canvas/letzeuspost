import { SlideSchema, type Slide } from '../../packages/core/src/index.ts';
import { PHOTO } from './assets.ts';

// The golden renders' sample content (§08 Golden renders, §17): a slide per launch layout in English and in Bangla,
// from the sample brand that layout belongs to (`matrix.ts`). Each language is written on its own, for its own reader,
// the way the AI is asked to write it (product principle 6): the Bangla is never the English translated, so the two
// say different things. Every person, number and source is made up. Bangla uses Bangla digits (§07).

export type Lang = 'en' | 'bn';
type Of<L extends Slide['layout']> = Extract<Slide, { layout: L }>;

/** The layouts the renderer draws at launch (§18), each with its sample in both languages. */
export type LaunchSamples = {
  [
    L in
      'cover' | 'fact' | 'step' | 'list' | 'quote' | 'stat' | 'question' | 'offer' | 'cta' | 'text'
  ]: Record<Lang, Of<L>>;
};

const photo = { asset: PHOTO };

export const SAMPLES: LaunchSamples = {
  // Kathgolap Books
  cover: {
    en: {
      layout: 'cover',
      kicker: 'Saturday reading hour',
      title: 'Bring a *book*, stay for tea',
      body: 'Our reading room opens early this weekend, with quiet corners and a fresh pot of tea.',
      image: photo,
      sticker: 'Free',
      alt: 'A reading room in soft morning light',
    },
    bn: {
      layout: 'cover',
      kicker: 'বর্ষার আড্ডা',
      title: 'বৃষ্টির দিনে *বই* আর চা',
      body: 'জানালার পাশে বসে প্রিয় বইয়ের সাথে কাটুক একটা অলস বিকেল।',
      image: photo,
      sticker: 'নতুন',
      alt: 'জানালার পাশে বইয়ের তাক',
    },
  },
  // Tidewell Dental
  fact: {
    en: {
      layout: 'fact',
      kicker: 'Did you know?',
      title: 'A toothbrush *wears out* in about three months',
      image: photo,
      body: 'Frayed bristles miss the gum line, so swap your brush each time the season changes.',
      source: 'Tidewell Dental care guide, 2026',
      alt: 'A new toothbrush beside a worn one',
    },
    bn: {
      layout: 'fact',
      kicker: 'জানেন কি?',
      title: 'চিনির চেয়ে বেশি ক্ষতি করে *বারবার* খাওয়া',
      image: photo,
      body: 'সারাদিন একটু একটু মিষ্টি খেলে দাঁত বিশ্রাম পায় না, তাই মিষ্টি খান খাবারের পর একবারেই।',
      source: 'টাইডওয়েল ডেন্টালের রোগী নির্দেশিকা, ২০২৬',
      alt: 'মিষ্টির প্লেট আর এক গ্লাস পানি',
    },
  },
  // Chaka Cycle Works
  step: {
    en: {
      layout: 'step',
      n: 2,
      of: 5,
      image: photo,
      title: 'Check your tyre *pressure*',
      body: 'Press the tyre with your thumb: it should give a little but never fold. The side of the tyre shows the range.',
      alt: 'A thumb pressing a bicycle tyre',
    },
    bn: {
      layout: 'step',
      n: 3,
      of: 4,
      image: photo,
      title: 'চেইনে দিন *দুই* ফোঁটা তেল',
      body: 'প্যাডেল উল্টো দিকে ঘোরাতে ঘোরাতে প্রতিটি লিংকে তেল দিন, তারপর বাড়তি তেল কাপড়ে মুছে ফেলুন।',
      alt: 'সাইকেলের চেইনে তেল দেওয়া হচ্ছে',
    },
  },
  // Kathgolap Books
  list: {
    en: {
      layout: 'list',
      title: 'Four ways to *read* more this month',
      items: [
        'Keep a book by your bed',
        'Read ten pages before your phone',
        'Swap one podcast for an audiobook',
        'Join our Saturday reading circle',
      ],
      alt: 'A list of four reading habits',
    },
    bn: {
      layout: 'list',
      title: 'ছোটদের *পড়ার* অভ্যাস গড়বেন যেভাবে',
      items: [
        'ঘুমের আগে একসাথে গল্প পড়ুন',
        'ছবির বই দিয়ে শুরু করুন',
        'বইমেলায় নিজের বই নিজে বাছতে দিন',
        'পড়া শেষে গল্পটা শুনুন ওর মুখে',
      ],
      alt: 'ছোটদের পড়ার অভ্যাসের তালিকা',
    },
  },
  // Tidewell Dental
  quote: {
    en: {
      layout: 'quote',
      quote: 'We would rather see you twice a year for a clean than once for a filling.',
      person: 'Dr Nadia Whitcombe',
      role: 'Lead dentist, Tidewell Dental',
      public: false,
      alt: 'A quote from Dr Nadia Whitcombe',
    },
    bn: {
      layout: 'quote',
      quote: 'শিশুরা ভয় পায় না, ভয় পায় বড়রা; তাই আমরা আগে গল্প করি, পরে চিকিৎসা।',
      person: 'ডা. ফারহানা ইসলাম',
      role: 'শিশু দন্তচিকিৎসক, টাইডওয়েল ডেন্টাল',
      public: false,
      alt: 'ডা. ফারহানা ইসলামের উক্তি',
    },
  },
  // Chaka Cycle Works
  stat: {
    en: {
      layout: 'stat',
      number: '1,200 km',
      label: 'ridden together on our weekend rides last year',
      source: 'Chaka Cycle Works ride log, 2026',
      alt: '1,200 kilometres ridden together last year',
    },
    bn: {
      layout: 'stat',
      number: '৩৪০',
      label: 'জন নতুন চালক সাইকেল চালানো শিখেছেন আমাদের শুক্রবারের ক্লাসে',
      source: 'চাকা সাইকেল ওয়ার্কস, ২০২৬',
      alt: '৩৪০ জন নতুন সাইকেল চালক',
    },
  },
  // Kathgolap Books
  question: {
    en: {
      layout: 'question',
      kicker: 'Your turn',
      question: 'Which book would you *reread* first?',
      options: [
        { text: 'A childhood favourite' },
        { text: 'The one that made you cry' },
        { text: 'A mystery you solved early' },
      ],
      alt: 'A question with three answers',
    },
    bn: {
      layout: 'question',
      kicker: 'আপনার মত',
      question: 'বৃষ্টির দিনে কোন *ধরনের* বই টানে?',
      options: [
        { text: 'গোয়েন্দা গল্প' },
        { text: 'কবিতার বই' },
        { text: 'ভ্রমণকাহিনি' },
        { text: 'ছোটদের রূপকথা' },
      ],
      alt: 'চারটি উত্তরের একটি প্রশ্ন',
    },
  },
  // Tidewell Dental
  offer: {
    en: {
      layout: 'offer',
      badge: 'This month',
      title: 'Family check-up *Saturdays*',
      details:
        'Bring the whole family: check-ups for children under twelve are free with a parent’s visit.',
      price: 'BDT 1,500 per adult',
      image: photo,
      cta: 'Book a Saturday',
      alt: 'A family in a bright dental waiting room',
    },
    bn: {
      layout: 'offer',
      badge: 'ঈদের আগে',
      title: 'হাসিমুখে *ঈদ*',
      details: 'ঈদের আগের দুই সপ্তাহ স্কেলিং আর পলিশিং একসাথে, সন্ধ্যা সাতটা পর্যন্ত খোলা।',
      price: '৳২,৫০০',
      image: photo,
      cta: 'সময় নিন',
      alt: 'ঝকঝকে হাসি',
    },
  },
  // Chaka Cycle Works
  cta: {
    en: {
      layout: 'cta',
      mark: 'mascot',
      title: 'Ride with us *this* Sunday',
      body: 'Meet at the shop at seven. Easy pace, and coffee at the halfway stop.',
      cta: 'Save your place',
      alt: 'Chaka Cycle Works: save your place on Sunday’s ride',
    },
    bn: {
      layout: 'cta',
      mark: 'logo',
      title: 'পুরনো সাইকেল, *নতুন* চলা',
      body: 'যেকোনো সাইকেল নিয়ে আসুন, এক দিনেই সার্ভিস করে ফেরত দেব।',
      cta: 'আজই আসুন',
      alt: 'চাকা সাইকেল ওয়ার্কস: আজই আসুন',
    },
  },
  // Kathgolap Books
  text: {
    en: {
      layout: 'text',
      kicker: 'From the shelf',
      title: 'Old books *smell* sweet for a reason',
      body: 'As paper ages, part of it breaks down into vanillin, the same molecule that gives vanilla its scent.',
      source: 'Kathgolap Books reading notes, 2026',
      alt: 'A stack of old books',
    },
    bn: {
      layout: 'text',
      kicker: 'দোকানের খাতা থেকে',
      title: 'প্রতিটি পুরনো *বইয়ের* একটা গল্প আছে',
      body: 'গত মাসে এক পাঠক দিয়ে গেছেন তাঁর দাদার সংগ্রহের দুশো বই, প্রতিটির পাতায় হাতে লেখা নোট।',
      source: 'কাঠগোলাপ বুকস, ২০২৬',
      alt: 'পুরনো বইয়ের স্তূপ',
    },
  },
};

/** The sample slide of `layout` in `lang`. */
export function sampleSlide(layout: keyof LaunchSamples, lang: Lang): Slide {
  return SAMPLES[layout][lang];
}

// The longest allowed text (the hard case): §07 caps a cover title, a list item and an answer at 8 words, so those
// get 8 long words (and a list 5 items, a question 4 answers); the other fields have no cap, so they get text well past
// what the sample has, which the fit check then reports. Every field the sample draws is filled, nothing is added.

type Longest = {
  /** A cover title: 8 long words, one highlighted. */
  coverTitle: string;
  /** 8 long words each: the 5 list items, and the first 4 as answers. */
  eightWords: readonly [string, string, string, string, string];
  /** Any other title or question. */
  headline: string;
  /** A body, details, a label or a quote. */
  paragraph: string;
  /** A kicker, sticker, badge, call to action, person, role, source or price. */
  line: string;
  /** A stat's number. */
  number: string;
};

const LONGEST: Record<Lang, Longest> = {
  en: {
    coverTitle:
      'Extraordinary *neighbourhood* storytelling celebrations throughout unforgettable wintertime afternoons',
    eightWords: [
      'Comfortable understanding develops through consistent, thoughtful, uninterrupted practice',
      'Remarkable conversations happen whenever neighbours share recommendations generously',
      'Professional craftspeople recommend straightforward maintenance alongside careful observation',
      'Unhurried weekends encourage wonderfully imaginative, independent, curious explorations',
      'Responsible communities celebrate extraordinary achievements with heartfelt acknowledgement',
    ],
    headline:
      'Everything our neighbourhood customers *wanted* to understand about thoughtful, comfortable and wonderfully unhurried weekends together',
    paragraph:
      'Throughout the year our neighbourhood community gathers for conversations, demonstrations and celebrations that encourage everyone, whatever their experience, to try something unfamiliar, ask straightforward questions and share recommendations generously; afterwards, participants consistently describe these unhurried afternoons as the most memorable, rewarding and genuinely restorative part of their week.',
    line: 'Independent neighbourhood establishment celebrating extraordinary craftsmanship together',
    number: '1,234,567,890',
  },
  bn: {
    coverTitle:
      'প্রতিদিনের জীবনযাত্রায় স্বাস্থ্যসম্মত *পরিচ্ছন্নতা* স্বতঃস্ফূর্তভাবে অন্তর্ভুক্ত করার পরামর্শ',
    eightWords: [
      'পরিবেশবান্ধব যাতায়াতে প্রতিবেশীদের সঙ্গে আত্মীয়তার সম্পর্ক গড়ে তুলুন',
      'অভিজ্ঞ প্রশিক্ষকদের তত্ত্বাবধানে নিয়মিত অনুশীলনে আত্মবিশ্বাস বাড়ে প্রতিদিন',
      'সাপ্তাহিক আলোচনাসভায় অংশগ্রহণকারীদের অভিজ্ঞতা শুনে নতুন দৃষ্টিভঙ্গি পাবেন',
      'পরিবারের জন্য সাশ্রয়ী মূল্যে বিশেষজ্ঞ পরামর্শের সুব্যবস্থা থাকছে',
      'শীতকালীন উৎসবে স্থানীয় শিল্পীদের তৈরি অসাধারণ সংগ্রহ দেখুন',
    ],
    headline:
      'প্রতিবেশী পাঠক আর গ্রাহকদের *সবচেয়ে* বেশি জিজ্ঞাসিত প্রশ্নগুলোর উত্তর একসাথে, বিস্তারিত ব্যাখ্যাসহ সাজানো',
    paragraph:
      'বছরজুড়ে আমাদের প্রতিবেশী সম্প্রদায় আলোচনা, প্রদর্শনী আর উৎসবের জন্য একত্র হয়, যেখানে অভিজ্ঞতা যা-ই হোক না কেন, প্রত্যেকে নতুন কিছু চেষ্টা করতে, সহজ প্রশ্ন করতে আর উদারভাবে পরামর্শ ভাগ করে নিতে উৎসাহ পান; অংশগ্রহণকারীরা পরে বারবার বলেন, এই অবসরের বিকেলগুলোই তাঁদের সপ্তাহের সবচেয়ে স্মরণীয়, আনন্দদায়ক আর সত্যিকারের প্রশান্তির সময়।',
    line: 'স্বাধীন প্রতিবেশী প্রতিষ্ঠানের অসাধারণ কারুশিল্পের বার্ষিক উদযাপন একসাথে',
    number: '১,২৩৪,৫৬৭,৮৯০',
  },
};

/** Fields by what they hold, for the longest text. */
const LINES = ['kicker', 'sticker', 'badge', 'cta', 'person', 'role', 'source', 'price'];
const PARAGRAPHS = ['body', 'details', 'label', 'quote'];
const HEADLINES = ['title', 'question'];

/** The slide with the longest allowed text in every field it draws (the alt text is left as it was: it isn't drawn). */
export function longest(slide: Slide, lang: Lang): Slide {
  const text = LONGEST[lang];
  const filled = Object.fromEntries(
    Object.entries(slide).map(([field, value]) => {
      if (slide.layout === 'cover' && field === 'title') return [field, text.coverTitle];
      if (field === 'items') return [field, [...text.eightWords]];
      if (field === 'options')
        return [field, text.eightWords.slice(0, 4).map((t) => ({ text: t }))];
      if (field === 'number') return [field, text.number];
      if (HEADLINES.includes(field)) return [field, text.headline];
      if (PARAGRAPHS.includes(field)) return [field, text.paragraph];
      if (LINES.includes(field)) return [field, text.line];
      return [field, value];
    }),
  );
  return SlideSchema.parse(filled);
}

/**
 * Bangla full of conjuncts, ya-phala and reph (the hard case), on Kathgolap's text slide: three-letter conjuncts
 * (উজ্জ্বল, শাস্ত্রীয়, চন্দ্রমল্লিকা), reph (সূর্য, অর্ধশতাব্দী), ya-phala (সন্ধ্যা, ব্যস্ত) and ya-phala after ra, which needs
 * the zero-width joiner (র‍্যাক, §08) or it becomes a reph.
 */
export const CONJUNCTS: Of<'text'> = {
  layout: 'text',
  kicker: 'বিশেষ সংখ্যা: স্মৃতির ঐশ্বর্য',
  title: 'সূর্যাস্তে *চন্দ্রমল্লিকার* স্নিগ্ধ সৌন্দর্য',
  body: 'কর্ণফুলীর তীরে উজ্জ্বল সন্ধ্যায় বিশ্বস্ত বন্ধুদের সঙ্গে শাস্ত্রীয় সংগীতের অনুষ্ঠানে ব্যস্ত শ্রোতাদের জন্য র‍্যাকভর্তি দুষ্প্রাপ্য গ্রন্থ, নির্বাচিত কাব্যসংগ্রহ আর অর্ধশতাব্দীর দর্শনীয় পত্রিকা সাজিয়েছি; প্রত্যেক পাঠকের জন্য থাকছে স্বাস্থ্যকর পানীয় আর মিষ্টান্ন।',
  source: 'সাহিত্য পরিষদের ত্রৈমাসিক পত্রিকা, শ্রাবণ ১৪৩৩',
  alt: 'চন্দ্রমল্লিকা ফুল আর পুরনো পত্রিকা',
};

/**
 * An English cover that names the brand in Bangla (the hard case): the kit's English fonts have no Bangla, so the
 * browser draws those letters in a system font, and the render reports the fallback (§08: no fallback fonts).
 */
export const NO_BANGLA_FONT: Of<'cover'> = {
  layout: 'cover',
  kicker: 'Behind the name',
  title: 'Why we are called *কাঠগোলাপ*',
  body: 'The frangipani tree outside our first shop gave us the name, and its flowers still mark every book we sell.',
  image: photo,
  alt: 'A frangipani flower on a book cover',
};
