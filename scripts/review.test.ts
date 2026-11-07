import { describe, expect, it } from 'vitest';
import { reviewPrompt } from './merge-gate/meta.ts';
import { planReviewers, resultText } from './review.ts';

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
