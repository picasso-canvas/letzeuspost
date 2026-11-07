import { describe, expect, it } from 'vitest';
import { judge, parseJsonLines } from './risk-gate.ts';

const LIST = `# sensitive
packages/auth/**   packages/db/**   .github/**   scripts/**   **/CLAUDE.md   docs/plan/**`;

describe('judge', () => {
  it('marks a PR that touches a sensitive path as sensitive, naming the paths', () => {
    const result = judge(['packages/auth/src/session.ts', 'packages/ui/src/b.ts'], LIST);
    expect(result.tier).toBe('sensitive');
    expect(result.sensitive).toEqual(['packages/auth/src/session.ts']);
    expect(result.summary).toContain('packages/auth/src/session.ts');
  });

  it('marks UI-only and docs outside docs/plan/ as routine', () => {
    expect(judge(['packages/ui/src/button.ts'], LIST).tier).toBe('routine');
    expect(judge(['docs/design/notes.md'], LIST).tier).toBe('routine');
  });

  it('flags harness changes', () => {
    const result = judge(['.github/workflows/ci.yml', 'packages/db/CLAUDE.md'], LIST);
    expect(result.tier).toBe('sensitive');
    expect(result.harness).toBe(true);
    expect(result.summary).toMatch(/harness/i);
  });

  it('sees dot folders and any letter case', () => {
    expect(judge(['packages/auth/.internal/x.ts'], LIST).tier).toBe('sensitive');
    expect(judge(['packages/web/Claude.md'], LIST).tier).toBe('sensitive');
  });

  it('fails safe: no list on main, or no changed files, is sensitive', () => {
    expect(judge(['packages/ui/a.ts'], null).tier).toBe('sensitive');
    expect(judge([], LIST).tier).toBe('sensitive');
  });
});

describe('parseJsonLines', () => {
  it('keeps odd file names whole and refuses anything that is not a string', () => {
    expect(parseJsonLines('"a.ts"\n"odd\\nname.ts"\n\n')).toEqual(['a.ts', 'odd\nname.ts']);
    expect(() => parseJsonLines('42')).toThrow();
  });
});
