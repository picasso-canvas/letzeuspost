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
