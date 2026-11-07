import { describe, expect, it } from 'vitest';
import { checkTranscript, transcriptPath } from './meta.ts';

const transcript = (agent: string, bundle: string) =>
  [
    JSON.stringify({ type: 'agent-setting', agentSetting: agent, sessionId: 's-1' }),
    JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      content: `Review this pull request as argus. Everything below is in ${bundle}/`,
    }),
  ].join('\n');

describe('checkTranscript', () => {
  it('accepts the right agent reviewing this bundle', () => {
    expect(
      checkTranscript(transcript('argus-reviewer', '/b/pr-52/x'), 'argus-reviewer', '/b/pr-52/x'),
    ).toBeNull();
  });

  it('refuses another agent, another bundle, or no transcript at all', () => {
    expect(
      checkTranscript(
        transcript('cerberus-security', '/b/pr-52/x'),
        'argus-reviewer',
        '/b/pr-52/x',
      ),
    ).toMatch(/agent/);
    expect(
      checkTranscript(transcript('argus-reviewer', '/b/pr-52/y'), 'argus-reviewer', '/b/pr-52/x'),
    ).toMatch(/bundle/);
    expect(checkTranscript(null, 'argus-reviewer', '/b/pr-52/x')).toMatch(/transcript/);
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
