import { describe, expect, it } from 'vitest';
import { matchesAny, parsePatternList } from './paths.ts';

describe('parsePatternList', () => {
  it('splits on whitespace and drops comments', () => {
    const text = '# sensitive\npackages/auth/**   packages/db/**\n\n**/CLAUDE.md # every one\n';
    expect(parsePatternList(text)).toEqual(['packages/auth/**', 'packages/db/**', '**/CLAUDE.md']);
  });
});

describe('matchesAny', () => {
  it('matches globs, including root files for **/ patterns', () => {
    expect(matchesAny('package.json', ['**/package.json'])).toBe(true);
    expect(matchesAny('apps/web/package.json', ['**/package.json'])).toBe(true);
    expect(matchesAny('.github/workflows/ci.yml', ['.github/**'])).toBe(true);
    expect(matchesAny('packages/ui/src/a.ts', ['packages/auth/**'])).toBe(false);
  });

  it('lets globs match dot folders and dot files', () => {
    expect(matchesAny('packages/auth/.internal/session.ts', ['packages/auth/**'])).toBe(true);
    expect(matchesAny('.github/workflows/.evil.yml', ['.github/**'])).toBe(true);
    expect(matchesAny('scripts/merge-gate/.x/evaluate.ts', ['scripts/**'])).toBe(true);
    expect(matchesAny('.prettierrc.json', ['.prettierrc*'])).toBe(true);
    expect(matchesAny('apps/web/.x/CLAUDE.md', ['**/CLAUDE.md'])).toBe(true);
  });

  it('ignores letter case', () => {
    expect(matchesAny('packages/db/Claude.md', ['**/CLAUDE.md'])).toBe(true);
    expect(matchesAny('Scripts/dispatch.sh', ['scripts/**'])).toBe(true);
  });
});
