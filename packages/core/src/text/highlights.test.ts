import { describe, expect, it } from 'vitest';
import { parseHighlights } from './highlights.ts';

describe('parseHighlights', () => {
  it('returns one plain segment when there is no marker', () => {
    expect(parseHighlights('Plain text')).toEqual({
      segments: [{ text: 'Plain text', highlight: false }],
      issues: [],
    });
  });

  it('returns no segments for an empty text', () => {
    expect(parseHighlights('')).toEqual({ segments: [], issues: [] });
  });

  it('splits a highlighted word out, without the markers', () => {
    expect(parseHighlights('Big *sale* today')).toEqual({
      segments: [
        { text: 'Big ', highlight: false },
        { text: 'sale', highlight: true },
        { text: ' today', highlight: false },
      ],
      issues: [],
    });
  });

  it('handles two highlights and a highlight at the start and at the end', () => {
    expect(parseHighlights('*One* and *two*').segments).toEqual([
      { text: 'One', highlight: true },
      { text: ' and ', highlight: false },
      { text: 'two', highlight: true },
    ]);
  });

  it('highlights several words and Bangla words, a conjunct and a ZWJ word included', () => {
    expect(parseHighlights('*বাংলা ভাষা* ও *র‍্যাংকিং*')).toEqual({
      segments: [
        { text: 'বাংলা ভাষা', highlight: true },
        { text: ' ও ', highlight: false },
        { text: 'র‍্যাংকিং', highlight: true },
      ],
      issues: [],
    });
  });

  it('accepts punctuation outside the markers', () => {
    expect(parseHighlights('("*Sale*!")').segments).toEqual([
      { text: '("', highlight: false },
      { text: 'Sale', highlight: true },
      { text: '!")', highlight: false },
    ]);
  });

  it('accepts punctuation inside the markers', () => {
    expect(parseHighlights('*50%* off, *Sale!*').issues).toEqual([]);
  });

  it('rejects a marker inside an English word', () => {
    const { issues } = parseHighlights('ab*cd*');
    expect(issues).toContainEqual({
      code: 'highlight-inside-word',
      severity: 'error',
      start: 2,
      end: 3,
    });
  });

  it('rejects a marker that ends inside a word', () => {
    const { issues } = parseHighlights('*ab*cd');
    expect(issues).toContainEqual({
      code: 'highlight-inside-word',
      severity: 'error',
      start: 3,
      end: 4,
    });
  });

  it('rejects a marker inside a Bangla word (it would break the letter shaping)', () => {
    const { issues } = parseHighlights('বাং*লা*');
    expect(issues).toContainEqual({
      code: 'highlight-inside-word',
      severity: 'error',
      start: 3,
      end: 4,
    });
  });

  it('rejects a marker after a digit', () => {
    expect(parseHighlights('a5*b*').issues.map((issue) => issue.code)).toContain(
      'highlight-inside-word',
    );
  });

  it('rejects a marker that is never closed', () => {
    expect(parseHighlights('*abc').issues).toEqual([
      { code: 'highlight-unmatched', severity: 'error', start: 0, end: 1 },
    ]);
  });

  it('rejects a lone marker between spaces', () => {
    expect(parseHighlights('a * b').issues).toEqual([
      { code: 'highlight-unmatched', severity: 'error', start: 2, end: 3 },
    ]);
  });

  it('rejects an empty highlight', () => {
    const { issues } = parseHighlights('a ** b');
    expect(issues.map((issue) => issue.code)).toEqual([
      'highlight-unmatched',
      'highlight-unmatched',
    ]);
  });

  it('rejects an odd marker among pairs and still reads the pairs', () => {
    const result = parseHighlights('*a* b * c *d*');
    expect(result.issues).toEqual([
      { code: 'highlight-unmatched', severity: 'error', start: 6, end: 7 },
    ]);
    expect(result.segments.filter((segment) => segment.highlight)).toEqual([
      { text: 'a', highlight: true },
      { text: 'd', highlight: true },
    ]);
  });

  it('keeps a rejected marker as plain text, so nothing is dropped silently', () => {
    expect(parseHighlights('a *b').segments).toEqual([{ text: 'a *b', highlight: false }]);
  });

  it('never produces HTML: markup in the text stays text', () => {
    const result = parseHighlights('<b>*x*</b> & <i>');
    expect(result.segments).toEqual([
      { text: '<b>', highlight: false },
      { text: 'x', highlight: true },
      { text: '</b> & <i>', highlight: false },
    ]);
    for (const segment of result.segments) {
      expect(Object.keys(segment).sort()).toEqual(['highlight', 'text']);
    }
  });
});
