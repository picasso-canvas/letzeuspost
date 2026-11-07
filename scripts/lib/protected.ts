import { matchesAny } from './paths.ts';

/**
 * Paths a builder may never change (§20 part 2), at any depth and in any letter case. The builder settings block most
 * of them at the root and package level; ship.ts checks every changed path against this list and is the hard control.
 */
export const BUILDER_PROTECTED = [
  '**/.github/**',
  '**/.claude/**',
  'scripts/**',
  'docs/plan/**',
  '**/.husky/**',
  '**/.vscode/**',
  '**/.lzp/**',
  'tests/visual/approved/**',
  'tests/golden/**',
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
  '**/DESIGN.md',
  'pnpm-workspace.yaml',
  '**/tsconfig*.json',
  '**/eslint.config.*',
  '**/vitest.config.*',
  '**/playwright.config.*',
  '**/.prettierrc*',
  '**/.prettierignore',
  '**/.gitleaks.toml',
  '**/.gitleaksignore',
  '**/.npmrc',
  '**/.nvmrc',
  '**/.mcp.json',
  '**/.gitattributes',
  '**/.gitmodules',
  '**/.pnpmfile.cjs',
  '**/osv-scanner.toml',
];

/** One entry of `git diff --raw -z --no-renames`: the new file mode and the path. */
export interface RawChange {
  mode: string;
  path: string;
}

/** `git diff --raw -z` output: `:old new oldsha newsha status\0path\0` per file. */
export function parseRawDiff(raw: string): RawChange[] {
  const parts = raw.split('\0').filter((part) => part !== '');
  const changes: RawChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = (parts[i] ?? '').split(' ');
    changes.push({ mode: meta[1] ?? '', path: parts[i + 1] ?? '' });
  }
  return changes;
}

/**
 * A path part git, macOS or Windows would read as a path step or as `.git`: empty, `.`, `..`, or `.git` once the name
 * is normalised, characters macOS ignores (zero-width and the like) are dropped, an NTFS stream (`::$INDEX_ALLOCATION`)
 * is cut off and trailing dots and spaces are trimmed; also Windows' short name for it, `GIT~1`.
 */
function unsafePart(part: string): boolean {
  if (part === '' || part === '.' || part === '..') return true;
  const name = (
    part
      .normalize('NFC')
      .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
      .split(':')[0] ?? ''
  )
    .replace(/[. ]+$/, '')
    .toLowerCase();
  return name === '.git' || name === 'git~1';
}

/** Why a builder's branch may not be shipped; empty when it may. */
export function shipRefusals(changes: readonly RawChange[]): string[] {
  const reasons: string[] = [];
  if (changes.length === 0) reasons.push('the branch changes nothing');
  for (const { mode, path } of changes) {
    // A tree a builder crafted can hold names checkout would refuse; older git lets them in from a bundle unchecked.
    if (path.split('/').some(unsafePart)) reasons.push(`unsafe path: ${path}`);
    if (matchesAny(path, BUILDER_PROTECTED)) reasons.push(`protected path: ${path}`);
    if (mode === '120000') reasons.push(`symlink: ${path}`);
    if (mode === '160000') reasons.push(`submodule: ${path}`);
  }
  return reasons;
}

/** One commit of a builder's branch: its parents and what it changed against its only parent. */
export interface CommitChanges {
  sha: string;
  parents: string[];
  changes: RawChange[];
}

/** `git rev-list --reverse --parents <base>..<ref>` output: each commit with its parents, oldest first. */
export function parseRevList(out: string): { sha: string; parents: string[] }[] {
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha = '', ...parents] = line.trim().split(' ');
      return { sha, parents };
    });
}

/**
 * Why any single commit of the branch may not be shipped: the final tree alone can hide a protected path, symlink or
 * submodule that one commit added and a later one removed, and those commits would still be pushed. Builders commit
 * in a straight line from the base, so a merge commit is refused too.
 */
export function historyRefusals(commits: readonly CommitChanges[]): string[] {
  const reasons: string[] = [];
  for (const { sha, parents, changes } of commits) {
    const short = sha.slice(0, 7);
    if (parents.length !== 1) {
      reasons.push(`${short}: a merge commit (builders commit in a straight line)`);
      continue;
    }
    for (const reason of shipRefusals(changes)) {
      if (reason !== 'the branch changes nothing') reasons.push(`${short}: ${reason}`);
    }
  }
  return reasons;
}
