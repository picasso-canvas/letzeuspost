import type { TextIssue } from './issues.ts';

export type ValidateTextOptions = { lang: 'en' | 'bn'; surface: 'slide' | 'caption' };

export function validateText(
  text: string,
  _options: ValidateTextOptions,
): { text: string; issues: TextIssue[] } {
  return { text, issues: [] };
}
