import { describe, expect, it } from 'vitest';
import { parseRawDiff, shipRefusals } from './protected.ts';

const file = (path: string, mode = '100644') => ({ mode, path });

describe('shipRefusals', () => {
  it('lets ordinary code through', () => {
    expect(shipRefusals([file('packages/core/src/a.ts'), file('package.json')])).toEqual([]);
  });

  it('refuses protected paths at any depth and in any letter case', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      '.GitHub/workflows/x.yml',
      'scripts/merge-gate.ts',
      'SCRIPTS/x.sh',
      'CLAUDE.md',
      'packages/core/src/Claude.md',
      'apps/web/.claude/skills/x.md',
      'packages/core/test/tsconfig.json',
      'packages/ui/eslint.config.js',
      'docs/plan/20-builder-guardrails.md',
      '.pnpmfile.cjs',
      'packages/x/.npmrc',
      '.lzp/task.md',
    ]) {
      expect(shipRefusals([file(path)]), path).toEqual([`protected path: ${path}`]);
    }
  });

  it('refuses symlinks, submodules and empty branches', () => {
    expect(shipRefusals([file('packages/core/link', '120000')])).toEqual([
      'symlink: packages/core/link',
    ]);
    expect(shipRefusals([file('vendor/x', '160000')])).toEqual(['submodule: vendor/x']);
    expect(shipRefusals([])).toEqual(['the branch changes nothing']);
  });
});

describe('parseRawDiff', () => {
  it('reads modes and paths from git diff --raw -z', () => {
    const raw =
      ':000000 100644 0000000 1111111 A\0packages/a.ts\0:100644 120000 2222222 3333333 T\0odd\nname\0';
    expect(parseRawDiff(raw)).toEqual([
      { mode: '100644', path: 'packages/a.ts' },
      { mode: '120000', path: 'odd\nname' },
    ]);
  });
});

describe('shipRefusals: unsafe path parts', () => {
  it('refuses an empty, ".", ".." or ".git" part in any letter case', () => {
    for (const path of [
      '..',
      'a/../b',
      './a',
      'a//b',
      '.git/hooks/pre-push',
      'src/.GIT/config',
      'x/.Git',
    ]) {
      expect(shipRefusals([{ mode: '100644', path }]), path).toContain(`unsafe path: ${path}`);
    }
    expect(shipRefusals([{ mode: '100644', path: 'src/.gitkeep' }])).toEqual([]);
  });
});

describe('shipRefusals: names macOS or Windows treat as .git', () => {
  it('refuses .git hidden by ignorable characters, a trailing dot or space, and decomposed forms', () => {
    for (const path of [
      '.g\u200cit/config',
      'a/.GIT\u200d/hooks',
      '.git./x',
      'src/.git /x',
      '.\u0067\u200bit',
    ]) {
      expect(shipRefusals([{ mode: '100644', path }]), JSON.stringify(path)).toContain(
        `unsafe path: ${path}`,
      );
    }
    expect(shipRefusals([{ mode: '100644', path: 'src/.github-notes.md' }])).toEqual([]);
  });
});
