import { describe, expect, it } from 'vitest';

import { designLintProblems } from './design-lint.mjs';

/** @param {Array<{ severity: string, rule: string, path?: string, message: string }>} findings */
const report = (findings) => ({ findings, summary: {} });

describe('designLintProblems (#70)', () => {
  it('passes a report with only token summaries and unused-token warnings', () => {
    expect(
      designLintProblems(
        report([
          { severity: 'info', rule: 'token-summary', message: 'Design system defines 60 colors' },
          {
            severity: 'warning',
            rule: 'orphaned-tokens',
            path: 'colors.ring',
            message: 'never referenced',
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('fails a text pair under WCAG AA, which the linter only warns about (§05: every pair passes AA)', () => {
    expect(
      designLintProblems(
        report([
          {
            severity: 'warning',
            rule: 'contrast-ratio',
            path: 'components.card-text-faint',
            message:
              'textColor (#8e8a82) on backgroundColor (#ffffff) has contrast ratio 3.44:1, below WCAG AA minimum of 4.5:1.',
          },
        ]),
      ),
    ).toEqual([
      'components.card-text-faint: textColor (#8e8a82) on backgroundColor (#ffffff) has contrast ratio 3.44:1, below WCAG AA minimum of 4.5:1.',
    ]);
  });

  it('fails every error, such as a broken token reference', () => {
    expect(
      designLintProblems(
        report([
          {
            severity: 'error',
            rule: 'broken-ref',
            path: 'components.b',
            message: '{colors.nope} does not resolve',
          },
        ]),
      ),
    ).toEqual(['components.b: {colors.nope} does not resolve']);
  });

  it('fails a severity it does not know, so a renamed level cannot slip through', () => {
    expect(
      designLintProblems(
        report([{ severity: 'fatal', rule: 'broken-ref', path: 'components.b', message: 'x' }]),
      ),
    ).toEqual(['components.b: x']);
  });

  it('fails output that is not a lint report', () => {
    expect(designLintProblems({})).toEqual(['design.md lint printed no findings list']);
    expect(designLintProblems(null)).toEqual(['design.md lint printed no findings list']);
  });
});
