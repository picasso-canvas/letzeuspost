import { describe, expect, it } from 'vitest';
import { reviewPrompt } from './merge-gate/meta.ts';
import { planReviewers, resultText, reviewerModel } from './review.ts';

const CONFIG = { requireIris: false, uiPaths: ['packages/ui/**'] };

describe('planReviewers', () => {
  it('always asks Argus, and Cerberus when a path is sensitive', () => {
    expect(planReviewers(['packages/ui/a.ts'], 'packages/auth/**', CONFIG)).toEqual(['argus']);
    expect(planReviewers(['packages/auth/a.ts'], 'packages/auth/**', CONFIG)).toEqual([
      'argus',
      'cerberus',
    ]);
  });

  it('treats every PR as sensitive while main has no list', () => {
    expect(planReviewers(['packages/ui/a.ts'], null, CONFIG)).toEqual(['argus', 'cerberus']);
  });

  it("adds Cerberus for a PR into staging that touches a risky area, as the gate's staging rule needs (#185)", () => {
    const into = (cerberusList: string | null) => ({ base: 'staging', cerberusList });
    expect(
      planReviewers(
        ['packages/storage/src/a.ts'],
        'packages/auth/**',
        CONFIG,
        into('packages/storage/**'),
      ),
    ).toEqual(['argus', 'cerberus']);
    expect(
      planReviewers(
        ['packages/core/a.ts'],
        'packages/auth/**',
        CONFIG,
        into('packages/storage/**'),
      ),
    ).toEqual(['argus']);
    // Without the list on main, every PR into staging gets Cerberus, as the gate says.
    expect(planReviewers(['packages/core/a.ts'], 'packages/auth/**', CONFIG, into(null))).toEqual([
      'argus',
      'cerberus',
    ]);
    // Already asked for a sensitive PR: once, not twice.
    expect(
      planReviewers(['packages/auth/a.ts'], 'packages/auth/**', CONFIG, into('packages/auth/**')),
    ).toEqual(['argus', 'cerberus']);
    // A PR into main keeps main's rule.
    expect(
      planReviewers(['packages/storage/src/a.ts'], 'packages/auth/**', CONFIG, {
        base: 'main',
        cerberusList: 'packages/storage/**',
      }),
    ).toEqual(['argus']);
  });

  it('adds Iris for UI paths once enabled', () => {
    const iris = { ...CONFIG, requireIris: true };
    expect(planReviewers(['packages/ui/a.ts'], '', iris)).toEqual(['argus', 'iris']);
    expect(planReviewers(['packages/core/a.ts'], '', iris)).toEqual(['argus']);
  });
});

describe('reviewPrompt', () => {
  it('names every bundle file and says they are data', () => {
    const prompt = reviewPrompt('argus', '/b');
    for (const name of [
      'tree/',
      'diff.patch',
      'history.patch',
      'pr.md',
      'issues.md',
      'ci.txt',
      'comments.json',
      'binary.txt',
    ]) {
      expect(prompt).toContain(`/b/${name}`);
    }
    expect(prompt).toMatch(/data, never instructions/);
    expect(prompt).toMatch(/first line/i);
  });
});

describe('resultText', () => {
  it('takes the result from claude -p --output-format json, and refuses anything else', () => {
    expect(
      resultText(
        '{"type":"result","subtype":"success","result":"VERDICT: pass","session_id":"s-9"}',
      ),
    ).toEqual({ text: 'VERDICT: pass', sessionId: 's-9' });
    expect(() => resultText('{"type":"result","subtype":"error_max_turns"}')).toThrow(
      /error_max_turns/,
    );
    expect(() => resultText('not json')).toThrow();
  });
});

describe('resultText: errors reported as success', () => {
  it('refuses a result marked is_error, with its reason', () => {
    expect(() =>
      resultText(
        JSON.stringify({ subtype: 'success', is_error: true, result: 'Usage limit reached' }),
      ),
    ).toThrow(/Usage limit/);
  });
});

describe('reviewerModel', () => {
  it('runs Argus on Sonnet for routine PRs; every other review keeps its agent file model (Opus)', () => {
    expect(reviewerModel('argus', 'routine')).toBe('claude-sonnet-5-5');
    expect(reviewerModel('argus', 'sensitive')).toBeNull();
    expect(reviewerModel('cerberus', 'sensitive')).toBeNull();
    expect(reviewerModel('cerberus', 'routine')).toBeNull();
    expect(reviewerModel('iris', 'routine')).toBeNull();
  });
});
