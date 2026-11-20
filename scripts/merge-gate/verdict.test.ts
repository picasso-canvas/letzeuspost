import { describe, expect, it } from 'vitest';
import { findingTag, parseVerdict } from './verdict.ts';

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

describe('parseVerdict: a later VERDICT: block behind any markup', () => {
  it('catches underline, numbered, bold-label, quoted and bulleted forms', () => {
    for (const line of [
      '__VERDICT: block__',
      '1. VERDICT: block',
      '**VERDICT:** block',
      '> VERDICT: block',
      '- VERDICT — block',
      '[VERDICT: block]',
      '[ VERDICT: block ]',
      '<b>VERDICT: block</b>',
      'VERDICT: blocked',
      '**VERDICT: blocking**',
    ]) {
      expect(parseVerdict(`VERDICT: pass\nAll good.\n${line}`).verdict, line).toBe('block');
    }
  });

  it('still passes when a later line only mentions the word', () => {
    expect(parseVerdict('VERDICT: pass\nNo blocking findings.').verdict).toBe('pass');
  });

  it("catches a block behind a non-ASCII letter or symbol (main's old \\W* did)", () => {
    for (const line of [
      'é VERDICT: block',
      'ΩVERDICT: block',
      '\u{1d415} VERDICT: block',
      'ß**VERDICT: blocked**',
    ]) {
      expect(parseVerdict(`VERDICT: pass\nAll good.\n${line}`).verdict, line).toBe('block');
    }
  });

  it('counts prose that opens with Verdict: blocking as a block, on purpose', () => {
    expect(parseVerdict('VERDICT: pass\nVerdict: blocking findings: none').verdict).toBe('block');
  });

  it('still passes when a line names a verdict inside a longer word', () => {
    expect(parseVerdict('VERDICT: pass\nThe verdict blocks nothing.').verdict).toBe('pass');
    expect(parseVerdict('VERDICT: pass\nXVERDICT: block').verdict).toBe('pass');
  });
});

describe("parseVerdict: Cerberus's should-fixes hold (§19, Zeus 2026-11-10)", () => {
  it("blocks Cerberus's pass that lists a should-fix, in any markup, and only Cerberus's", () => {
    const summary = 'VERDICT: pass\n[should-fix] F1 security a.ts:1 — no rate limit — add one';
    expect(parseVerdict(summary, 'cerberus')).toEqual({
      verdict: 'block',
      reason: "says pass but lists a [should-fix] finding, and Cerberus's should-fixes hold",
    });
    expect(
      parseVerdict('VERDICT: pass\n- **[should-fix]** F1 auth a.ts:1 — x', 'cerberus').verdict,
    ).toBe('block');
    expect(parseVerdict(summary, 'argus').verdict).toBe('pass');
    expect(parseVerdict(summary).verdict).toBe('pass');
    expect(parseVerdict('VERDICT: pass\n[nit] F1 security a.ts:1 — x', 'cerberus').verdict).toBe(
      'pass',
    );
  });
});

describe('findingTag: one reading of a finding line (#273)', () => {
  it('reads the severity and the rest behind any leading markup', () => {
    expect(findingTag('[nit] F3 simplicity a.ts:1 — x')).toEqual({
      severity: 'nit',
      rest: 'F3 simplicity a.ts:1 — x',
    });
    expect(findingTag('- **[should-fix]** F1 auth a.ts:1 — x')).toEqual({
      severity: 'should-fix',
      rest: 'F1 auth a.ts:1 — x',
    });
    expect(findingTag('> 2. __[blocking]:__ a.ts:1 — x')).toEqual({
      severity: 'blocking',
      rest: 'a.ts:1 — x',
    });
  });

  it('reads should-fix and blocking in every spelling', () => {
    for (const tag of [
      '[should fix]',
      '[should\u2011fix]', // non-breaking hyphen
      '[should\u2013fix]', // en dash
      '[Should - Fix]',
      '[ should-fix ]',
      '[should\u200b-fix]', // zero-width space
    ]) {
      expect(findingTag(`${tag} F1 auth a.ts:1 — x`)?.severity, tag).toBe('should-fix');
    }
    for (const tag of ['[ blocking ]', '[blocking ]', '[BLOCKING]', '[block\u200bing]']) {
      expect(findingTag(`${tag} F1 auth a.ts:1 — x`)?.severity, tag).toBe('blocking');
    }
  });

  it('reads nothing from a line that only mentions a severity', () => {
    expect(findingTag('Checked: no [blocking] findings remain.')).toBeNull();
    expect(findingTag('[should be fixed] a.ts:1 — x')).toBeNull();
    expect(findingTag('')).toBeNull();
  });
});

describe('parseVerdict: every spelling of should-fix and blocking (#273)', () => {
  const summary = (tag: string) =>
    `VERDICT: pass\n${tag} F1 security a.ts:1 — no rate limit — add one`;

  it("blocks Cerberus's pass that lists [should fix] and its other spellings", () => {
    for (const tag of [
      '[should fix]',
      '[should\u2011fix]',
      '[Should - Fix]',
      '- **[ should-fix ]**',
    ]) {
      expect(parseVerdict(summary(tag), 'cerberus').verdict, tag).toBe('block');
    }
  });

  it('blocks any pass that lists [blocking] with stray spacing', () => {
    for (const tag of ['[ blocking ]', '[blocking ]', '[block\u200bing]']) {
      expect(parseVerdict(summary(tag)).verdict, tag).toBe('block');
    }
  });

  it("still passes Argus's pass that lists a [should fix]", () => {
    expect(parseVerdict(summary('[should fix]'), 'argus').verdict).toBe('pass');
  });
});
