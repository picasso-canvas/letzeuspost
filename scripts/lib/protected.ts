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

/** Why a builder's branch may not be shipped; empty when it may. */
export function shipRefusals(changes: readonly RawChange[]): string[] {
  const reasons: string[] = [];
  if (changes.length === 0) reasons.push('the branch changes nothing');
  for (const { mode, path } of changes) {
    if (matchesAny(path, BUILDER_PROTECTED)) reasons.push(`protected path: ${path}`);
    if (mode === '120000') reasons.push(`symlink: ${path}`);
    if (mode === '160000') reasons.push(`submodule: ${path}`);
  }
  return reasons;
}
