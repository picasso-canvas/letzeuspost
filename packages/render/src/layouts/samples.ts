import type { Post, Slide } from '@lzp/core';

// Sample content for the cover, cta and step layouts, written for the specs: a made-up physio practice ("Stillwater
// Physio") in English and a made-up café ("Meghla Cafe") in Bangla. No real brand, no real person. Typical copy is what
// the AI would write; the longest copy is §07's limits (a cover title of 8 words) and long words, to see what the fit
// check does at the edge.

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

/** A long paragraph, as a field's longest honest text: about 40 words. */
export const LONG_BODY: Record<Lang, string> = {
  en: 'Most desk pain starts with small habits repeated for hours: a screen that sits too low, a chair that is too deep, a phone held between ear and shoulder. Change one of them this week and notice how your neck feels by the evening.',
  bn: 'ডেস্কের ব্যথা বেশির ভাগ সময় শুরু হয় ছোট ছোট অভ্যাস থেকে: স্ক্রিন খুব নিচে, চেয়ার খুব গভীর, কিংবা কাঁধ আর কানের মাঝে ফোন ধরে রাখা। এই সপ্তাহে একটি অভ্যাস বদলান, সন্ধ্যায় ঘাড়ের পার্থক্য টের পাবেন।',
};
