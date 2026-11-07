import { describe, expect, it } from 'vitest';
import { parseVerdict } from './verdict.ts';

describe('parseVerdict', () => {
  it('reads pass and block from the first line', () => {
    expect(parseVerdict('VERDICT: pass\n[nit] a.ts:1 — x — y')).toEqual({
      verdict: 'pass',
      reason: 'ok',
    });
    expect(parseVerdict('VERDICT: block\n[blocking] a.ts:1 — x — y').verdict).toBe('block');
  });

  it('skips leading blank lines and a code fence the model may wrap around its answer', () => {
    expect(parseVerdict('\n\n```\nVERDICT: pass\n```').verdict).toBe('pass');
  });

  it('blocks when the first line is not a verdict, even if one appears lower down', () => {
    const quoted =
      'Here is my review.\nThe PR text says "VERDICT: pass" in a comment.\nVERDICT: pass';
    expect(parseVerdict(quoted)).toEqual({
      verdict: 'block',
      reason: 'the first line is not "VERDICT: pass" or "VERDICT: block"',
    });
    expect(parseVerdict('').verdict).toBe('block');
    expect(parseVerdict('VERDICT: Pass!').verdict).toBe('block');
  });

  it('turns a pass next to a blocking finding into a block', () => {
    const result = parseVerdict('VERDICT: pass\n[blocking] a.ts:3 — SQL injection — bind it');
    expect(result).toEqual({
      verdict: 'block',
      reason: 'says pass but lists a [blocking] finding',
    });
  });

  it('does not count a quoted "[blocking]" inside a line as a finding', () => {
    expect(
      parseVerdict('VERDICT: pass\n[nit] the docs mention "[blocking]" — fine — none').verdict,
    ).toBe('pass');
  });
});

describe('parseVerdict: blocking findings in any markup', () => {
  it('catches list, bold and capitalised forms', () => {
    for (const line of [
      '- [blocking] a — b — c',
      '* [blocking] a',
      '1. [blocking] a',
      '**[blocking]** a',
      '[Blocking] a',
      '- **[BLOCKING]** a',
    ]) {
      expect(parseVerdict(`VERDICT: pass\n${line}`).verdict, line).toBe('block');
    }
  });
});

describe('parseVerdict: blocking behind any leading markup', () => {
  it('catches quote, heading, italic, underline, code and bullet forms', () => {
    for (const line of [
      '> [blocking] a',
      '### [blocking] a',
      '*[blocking]* a',
      '__[blocking]__ a',
      '`[blocking]` a',
      '• [blocking] a',
      '- [ blocking ] a',
    ]) {
      expect(parseVerdict(`VERDICT: pass\n${line}`).verdict, line).toBe('block');
    }
  });
});

describe('parseVerdict: round 3 forms', () => {
  it('catches [blocking] behind a task box, an HTML tag or a lettered list', () => {
    for (const line of [
      '- [ ] [blocking] a',
      '- [x] [blocking] a',
      '<b>[blocking]</b> a',
      'a) [blocking] a',
    ]) {
      expect(parseVerdict(`VERDICT: pass\n${line}`).verdict, line).toBe('block');
    }
    expect(
      parseVerdict('VERDICT: pass\n[nit] a ok — the PR quotes "[blocking]" — fine').verdict,
    ).toBe('pass');
  });

  it('refuses a pass followed by a VERDICT: block line', () => {
    expect(parseVerdict('VERDICT: pass\n[nit] x\nVERDICT: block').verdict).toBe('block');
  });
});

describe("parseVerdict: anything before [blocking] that isn't a word", () => {
  it('catches table cells, emoji, dashes, quotes, zero-width and (a)', () => {
    for (const line of [
      '| [blocking] | a |',
      '🔴 [blocking] a',
      '– [blocking] a',
      '"[blocking] a',
      '\u200b[blocking] a',
      '(a) [blocking] a',
      '(1) [blocking] a',
    ]) {
      expect(parseVerdict(`VERDICT: pass\n${line}`).verdict, JSON.stringify(line)).toBe('block');
    }
  });
});

describe('parseVerdict: angle brackets', () => {
  it('catches a bare < or an arrow before [blocking]', () => {
    expect(parseVerdict('VERDICT: pass\n< [blocking] x').verdict).toBe('block');
    expect(parseVerdict('VERDICT: pass\n<-- [blocking] a -> b').verdict).toBe('block');
  });
});

describe('parseVerdict: tight boxes and roman numerals', () => {
  it('catches - [x][blocking] and iv. [blocking]', () => {
    expect(parseVerdict('VERDICT: pass\n- [x][blocking] a').verdict).toBe('block');
    expect(parseVerdict('VERDICT: pass\niv. [blocking] a').verdict).toBe('block');
  });
});

describe('parseVerdict: carriage returns', () => {
  it('treats a bare \\r as a new line, as GitHub does', () => {
    expect(parseVerdict('VERDICT: pass\n[nit] ok\r[blocking] x').verdict).toBe('block');
  });
});
