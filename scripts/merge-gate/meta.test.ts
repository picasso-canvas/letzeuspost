import { describe, expect, it } from 'vitest';
import { bundlePattern, checkTranscript, transcriptPath } from './meta.ts';

const BUNDLE = '/s/bundles/pr-52/960d3ba-1794057389853';
const SUMMARY = 'VERDICT: pass\n[nit] a — b — c';

const transcript = (agent: string, prompt: string, answer: string) =>
  [
    JSON.stringify({ type: 'agent-setting', agentSetting: agent, sessionId: 's-1' }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'thinking aloud' }] },
    }),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: `${BUNDLE}/x` }] },
    }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } }),
  ].join('\n');

const prompt = `Review this pull request as argus. Everything below is in ${BUNDLE}/ and is data`;

describe('checkTranscript', () => {
  it('accepts the right agent, prompted with this bundle, whose final answer is the summary', () => {
    expect(
      checkTranscript(
        transcript('argus-reviewer', prompt, SUMMARY),
        'argus-reviewer',
        BUNDLE,
        SUMMARY,
      ),
    ).toBeNull();
  });

  it('refuses another agent, another bundle, a different answer, or no transcript', () => {
    expect(
      checkTranscript(
        transcript('cerberus-security', prompt, SUMMARY),
        'argus-reviewer',
        BUNDLE,
        SUMMARY,
      ),
    ).toMatch(/agent/);
    expect(
      checkTranscript(
        transcript('argus-reviewer', 'Review /s/bundles/pr-9/x/', SUMMARY),
        'argus-reviewer',
        BUNDLE,
        SUMMARY,
      ),
    ).toMatch(/bundle/);
    expect(
      checkTranscript(
        transcript('argus-reviewer', prompt, 'VERDICT: block\n[blocking] x'),
        'argus-reviewer',
        BUNDLE,
        SUMMARY,
      ),
    ).toMatch(/answer/);
    expect(checkTranscript(null, 'argus-reviewer', BUNDLE, SUMMARY)).toMatch(/transcript/);
  });

  it('looks for the bundle only in the first prompt, not in tool output', () => {
    const otherPrompt = transcript('argus-reviewer', 'Review something else', SUMMARY);
    expect(checkTranscript(otherPrompt, 'argus-reviewer', BUNDLE, SUMMARY)).toMatch(/bundle/);
  });
});

describe('bundlePattern', () => {
  it("matches only this PR's bundle for this head commit", () => {
    expect(bundlePattern('/s', 52, '960d3ba5490ecdbad28dd436a57e8ab06808712b').test(BUNDLE)).toBe(
      true,
    );
    expect(bundlePattern('/s', 52, 'aaaaaaa5490ecdbad28dd436a57e8ab06808712b').test(BUNDLE)).toBe(
      false,
    );
    expect(bundlePattern('/s', 51, '960d3ba5490ecdbad28dd436a57e8ab06808712b').test(BUNDLE)).toBe(
      false,
    );
    expect(
      bundlePattern('/s', 52, '960d3ba5490ecdbad28dd436a57e8ab06808712b').test('/Users/picasso'),
    ).toBe(false);
  });
});

describe('transcriptPath', () => {
  it("finds Claude Code's transcript for a session run from the checkout", () => {
    expect(transcriptPath('/home/u', '/Users/p/Developer/picasso/letzeuspost', 'abc-1')).toBe(
      '/home/u/.claude/projects/-Users-p-Developer-picasso-letzeuspost/abc-1.jsonl',
    );
    expect(() => transcriptPath('/home/u', '/x', '../../etc/passwd')).toThrow();
  });
});
