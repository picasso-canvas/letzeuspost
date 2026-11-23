import type { FontLanguage } from '../fonts/manifest.ts';

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

/** A whole number for a page of the given language: Bangla text takes Bangla digits (০–৯, §07), English Latin ones. */
export function formatNumber(value: number, language: FontLanguage): string {
  const latin = String(value);
  return language === 'bn'
    ? Array.from(latin, (char) => BANGLA_DIGITS[Number(char)] ?? char).join('')
    : latin;
}
