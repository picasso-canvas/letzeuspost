import type { TextIssue } from './issues.ts';

export type HighlightSegment = { text: string; highlight: boolean };

export function parseHighlights(text: string): {
  segments: HighlightSegment[];
  issues: TextIssue[];
} {
  return { segments: [{ text, highlight: false }], issues: [] };
}
