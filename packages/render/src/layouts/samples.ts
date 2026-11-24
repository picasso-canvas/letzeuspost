import type { Post, Slide } from '@lzp/core';

// Sample content for the cover, cta, step, fact, list and quote layouts, written for the specs: a made-up physio
// practice ("Stillwater Physio") in English and a made-up café ("Meghla Cafe") in Bangla. No real brand, no real
// person. Typical copy is what the AI would write; the longest copy is §07's limits (a cover title of 8 words) and
// long words, to see what the fit check does at the edge.

type Of<L extends Slide['layout']> = Extract<Slide, { layout: L }>;
export type Lang = Post['lang'];

const photo = { asset: 'photo_sample_1' };

export const SAMPLE_COVER: Record<Lang, Of<'cover'>> = {
  en: {
    layout: 'cover',
    kicker: 'Back care basics',
    title: 'Sit *better* and hurt less by Friday',
    body: 'Three small habits that take the strain off your back at your desk.',
    image: photo,
    sticker: 'New',
    alt: 'A person sitting upright at a desk',
  },
  bn: {
    layout: 'cover',
    kicker: 'শীতের আয়োজন',
    title: 'ফিরে এল *পিঠা* সপ্তাহ',
    body: 'এই শীতে নিয়ে এসেছি পুরনো দিনের স্বাদ, নতুন করে।',
    image: photo,
    sticker: 'নতুন',
    alt: 'পিঠার থালা',
  },
};

export const SAMPLE_STEP: Record<Lang, Of<'step'>> = {
  en: {
    layout: 'step',
    n: 2,
    of: 4,
    image: photo,
    title: 'Roll your shoulders *back*',
    body: 'Lift both shoulders to your ears, then slowly roll them back and down. Repeat five times.',
    alt: 'A person rolling their shoulders',
  },
  bn: {
    layout: 'step',
    n: 2,
    of: 4,
    image: photo,
    title: 'চালের গুঁড়ো *ভিজিয়ে* রাখুন',
    body: 'পাঁচ মিনিট ভিজিয়ে রাখলে গুঁড়ো নরম হয়, আর পিঠা হয় মোলায়েম।',
    alt: 'বাটিতে চালের গুঁড়ো',
  },
};

export const SAMPLE_CTA: Record<Lang, Of<'cta'>> = {
  en: {
    layout: 'cta',
    mark: 'logo',
    title: 'Ready to move *without* pain?',
    body: 'Book a first visit this month and we will build a plan around your week.',
    cta: 'Book a first visit',
    alt: 'Stillwater Physio: book a first visit',
  },
  bn: {
    layout: 'cta',
    mark: 'mascot',
    title: 'আসুন, একসাথে *পিঠা* খাই',
    body: 'শনিবার বিকেল চারটায় আমাদের দোকানে আপনাকে স্বাগত।',
    cta: 'টেবিল বুক করুন',
    alt: 'মেঘলা কাফে: টেবিল বুক করুন',
  },
};

/** Eight words, the most a cover title may have (§07), each a long one. */
export const LONGEST_COVER_TITLE: Record<Lang, string> = {
  en: 'Physiotherapy rehabilitation *strengthening* stretching mobility posture ergonomics recovery',
  bn: 'পরিবেশবান্ধব সম্প্রসারণশীল *প্রতিষ্ঠানগুলোর* সহযোগিতামূলক অংশগ্রহণে উন্নয়নশীল সম্ভাবনাময় দৃষ্টিভঙ্গি',
};

export const SAMPLE_FACT: Record<Lang, Of<'fact'>> = {
  en: {
    layout: 'fact',
    kicker: 'Did you know?',
    title: 'Sitting still for an hour *stiffens* your hips',
    image: photo,
    body: 'A short break every 30 minutes keeps your joints moving.',
    source: 'Stillwater Physio guide, 2026',
    alt: 'A person standing up from a desk to stretch',
  },
  bn: {
    layout: 'fact',
    kicker: 'আপনি কি জানেন?',
    title: 'শীতে পিঠা খেলে *শরীর* গরম থাকে',
    image: photo,
    body: 'চালের গুঁড়ো আর গুড়ের পিঠা শীতের সকালে দীর্ঘক্ষণ শক্তি জোগায়, তাই এই মৌসুমে এর কদর বেশি।',
    source: 'মেঘলা কাফের রান্নাঘরের খাতা, ২০২৬',
    alt: 'গুড়ের পিঠার থালা',
  },
};

export const SAMPLE_LIST: Record<Lang, Of<'list'>> = {
  en: {
    layout: 'list',
    title: 'Four habits for a *calmer* back',
    items: [
      'Screen at eye level',
      'Stand up every half hour',
      'Both feet flat on the floor',
      'Ten-minute walk after lunch',
    ],
    alt: 'A checklist of four desk habits',
  },
  bn: {
    layout: 'list',
    title: 'শীতের সকালের চারটি *নিয়ম*',
    items: [
      'ঘুম থেকে উঠে এক গ্লাস গরম পানি',
      'হালকা ব্যায়াম করুন পনেরো মিনিট',
      'সকালের নাস্তায় পিঠা বা রুটি রাখুন',
      'রোদে বসে কিছুক্ষণ সময় কাটান',
    ],
    alt: 'চারটি নিয়মের তালিকা',
  },
};

export const SAMPLE_QUOTE: Record<Lang, Of<'quote'>> = {
  en: {
    layout: 'quote',
    quote: 'Most people feel the difference in two weeks, once the small habits stick.',
    person: 'Dr Amara Lindqvist',
    role: 'Lead physiotherapist, Stillwater Physio',
    public: false,
    alt: 'A quote from Dr Amara Lindqvist',
  },
  bn: {
    layout: 'quote',
    quote: 'ভালো পিঠার রহস্য হলো তাড়াহুড়ো না করা, আর হাতের যত্ন।',
    person: 'রোকেয়া বেগম',
    role: 'প্রধান বাবুর্চি, মেঘলা কাফে',
    public: false,
    alt: 'রোকেয়া বেগমের উক্তি',
  },
};

/** A quote that is not the brand's own: it shows its source. The person and the words are invented. */
export const SAMPLE_PUBLIC_QUOTE: Record<Lang, Of<'quote'>> = {
  en: {
    layout: 'quote',
    quote: 'A body at rest wants to stay at rest, so give it a reason to move.',
    person: 'Ivo Marchetti',
    role: 'Sports scientist',
    public: true,
    source: 'Marchetti, Moving Well, 2019',
    alt: 'A quote from Ivo Marchetti',
  },
  bn: {
    layout: 'quote',
    quote: 'যে রান্নায় মন থাকে, তার স্বাদ কখনো ভোলা যায় না।',
    person: 'নাজমা সুলতানা',
    role: 'রন্ধনশিল্পী',
    public: true,
    source: 'নাজমা সুলতানা, রান্নাঘরের গল্প, ২০১৮',
    alt: 'নাজমা সুলতানার উক্তি',
  },
};

/** Five items of eight words each, the most a list may have (§07), each word a long one. */
export const LONGEST_LIST_ITEMS: Record<Lang, string[]> = {
  en: [
    'Physiotherapy rehabilitation strengthening stretching mobility posture ergonomics recovery',
    'Consistency matters considerably more than intensity throughout rehabilitation',
    'Hydration nutrition sleep movement recovery stretching breathing mindfulness',
    'Appointments assessments diagnoses treatments exercises follow-ups referrals discharge',
    'Understanding protecting strengthening improving maintaining supporting restoring celebrating',
  ],
  bn: [
    'পরিবেশবান্ধব সম্প্রসারণশীল প্রতিষ্ঠানগুলোর সহযোগিতামূলক অংশগ্রহণে উন্নয়নশীল সম্ভাবনাময় দৃষ্টিভঙ্গি',
    'আন্তর্জাতিক মানসম্পন্ন প্রশিক্ষণপ্রাপ্ত চিকিৎসকদের তত্ত্বাবধানে পরিচালিত পুনর্বাসন কার্যক্রম',
    'স্বাস্থ্যসচেতনতা পুষ্টিকর খাদ্যাভ্যাস নিয়মিত ব্যায়াম পর্যাপ্ত বিশ্রাম প্রশান্তি',
    'প্রাতিষ্ঠানিক সহযোগিতামূলক উদ্যোগগুলোর বাস্তবায়নযোগ্যতা নিরূপণ পদ্ধতিগত বিশ্লেষণ প্রতিবেদন',
    'সম্ভাবনাময় অভিজ্ঞতাসম্পন্ন দায়িত্বশীল পরিশ্রমী মনোযোগী সৃজনশীল উদ্ভাবনী নেতৃত্ব',
  ],
};

/** A long paragraph, as a field's longest honest text: about 40 words. */
export const LONG_BODY: Record<Lang, string> = {
  en: 'Most desk pain starts with small habits repeated for hours: a screen that sits too low, a chair that is too deep, a phone held between ear and shoulder. Change one of them this week and notice how your neck feels by the evening.',
  bn: 'ডেস্কের ব্যথা বেশির ভাগ সময় শুরু হয় ছোট ছোট অভ্যাস থেকে: স্ক্রিন খুব নিচে, চেয়ার খুব গভীর, কিংবা কাঁধ আর কানের মাঝে ফোন ধরে রাখা। এই সপ্তাহে একটি অভ্যাস বদলান, সন্ধ্যায় ঘাড়ের পার্থক্য টের পাবেন।',
};
