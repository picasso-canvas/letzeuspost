// PreToolUse Bash: a backup to the deny rules in .claude/settings.json (everyone) and .claude/builder/settings.json
// (builders). Settings rules match the command text from its start only; these look anywhere in the command, so
// `cd x && git push --force` or `sh -c "gh pr merge 1"` are caught too. Still a backstop, not a boundary: the
// sandbox, the missing GitHub credential and the merge gate are the boundaries.
import type { Role } from './freeze.ts';

export interface BashRule {
  id: string;
  scope: 'everyone' | 'builder';
  pattern: RegExp;
  reason: string;
}

// `[^;&|\n]*` keeps a match inside one simple command, so `git status && echo main` is not "a push to main".
const SAME = String.raw`[^;&|\n]*`;
const START = String.raw`(?:^|[\s;&|(\x60'"])`;

export const BASH_RULES: readonly BashRule[] = [
  {
    id: 'push-main',
    scope: 'everyone',
    pattern: new RegExp(String.raw`\bgit\b${SAME}\bpush\b${SAME}(?:\s|:|\+)(?:refs/heads/)?main\b`),
    reason: 'pushing to main is not allowed; open a PR and merge it through the merge gate',
  },
  {
    id: 'force-push',
    scope: 'everyone',
    pattern: new RegExp(
      String.raw`\bgit\b${SAME}\bpush\b${SAME}(?:--force\b|--force-with-lease\b|--mirror\b|\s-[a-zA-Z]*f\b|\s\+\S)`,
    ),
    reason: 'force pushes and mirror pushes are not allowed',
  },
  {
    id: 'no-verify',
    scope: 'everyone',
    pattern: new RegExp(
      String.raw`\bgit\b${SAME}\b(?:commit|push|merge)\b${SAME}(?:--no-verify\b|\s-[a-zA-Z]*n[a-zA-Z]*\b)`,
    ),
    reason: 'skipping git hooks (--no-verify / -n) is not allowed',
  },
  {
    id: 'pipe-to-shell',
    scope: 'everyone',
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|node|python3?)\b|\b(?:sh|bash|zsh)\b${SAME}(?:<\(|\$\()\s*(?:curl|wget)\b`,
    ),
    reason: 'piping a download into a shell (curl … | sh) is not allowed; ask Zeus',
  },
  {
    id: 'publish',
    scope: 'everyone',
    pattern: new RegExp(String.raw`${START}(?:npm|pnpm|yarn|bun)\s+${SAME}\bpublish\b`),
    reason: 'publishing packages is not allowed',
  },
  {
    id: 'repo-delete',
    scope: 'everyone',
    pattern: new RegExp(String.raw`${START}gh\s+repo\s+delete\b`),
    reason: 'deleting a repository is not allowed',
  },
  {
    id: 'gh-merge',
    scope: 'everyone',
    pattern: new RegExp(String.raw`${START}gh\s+(?:pr\s+merge\b|api\b${SAME}merge)`, 'i'),
    reason: 'merges go only through scripts/merge-gate.ts',
  },
  {
    id: 'builder-git-push',
    scope: 'builder',
    pattern: new RegExp(String.raw`\bgit\b${SAME}\bpush\b`),
    reason: 'builders never push; Athena ships the branch with scripts/ship.sh',
  },
  {
    id: 'builder-gh',
    scope: 'builder',
    pattern: new RegExp(String.raw`${START}(?:\S*/)?gh(?:\s|$)`),
    reason: 'builders have no GitHub access; write what you need in .lzp/pr.md',
  },
  {
    id: 'builder-keychain',
    scope: 'builder',
    pattern: new RegExp(String.raw`${START}(?:\S*/)?security\s`),
    reason: 'builders never touch the Keychain',
  },
  {
    id: 'builder-docker',
    scope: 'builder',
    pattern: /\bdocker\b|docker\.sock|\bpodman\b/,
    reason: 'builders have no Docker; dispatch starts the task’s services',
  },
  {
    id: 'builder-env-file',
    scope: 'builder',
    pattern: new RegExp(
      String.raw`${START}(?:\S*/)?\.env(?:rc|\.(?!example\b)[\w.-]+)?(?=$|[\s;&|)'"\x60])`,
    ),
    reason: 'builders never read or write .env files (only .env.example)',
  },
];

export interface BashHit {
  rule: BashRule;
}

export function checkBash(command: string, role: Role): BashHit | null {
  for (const rule of BASH_RULES) {
    if (rule.scope === 'builder' && role !== 'builder') continue;
    if (rule.pattern.test(command)) return { rule };
  }
  return null;
}
