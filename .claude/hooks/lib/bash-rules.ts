// PreToolUse Bash: a backup to the deny rules in .claude/settings.json (everyone) and .claude/builder/settings.json
// (builders). Settings rules match the command text from its start; these find a command wherever one starts in the
// line (`cd x && git push --force`, `sh -c "gh pr merge 1"`, `/opt/homebrew/bin/gh …`), and match the program and its
// subcommand rather than words anywhere, so `git commit -m "push notifications"` or `pnpm vitest run publish.test.ts`
// pass. Still a backstop, not a boundary: the sandbox, the missing GitHub credential and the merge gate are.
import type { Role } from './freeze.ts';

export interface BashRule {
  id: string;
  scope: 'everyone' | 'builder';
  pattern: RegExp;
  reason: string;
}

/**
 * Where a command starts: the line's start, after `; & | ( $(` a newline or a backtick, or inside `sh -c "…"` /
 * `eval '…'`; then any wrappers (`sudo`, `env`, `xargs`, …), `VAR=value` assignments and a path (`/usr/bin/`).
 */
const CMD = String.raw`(?:^|[;&|\n(\x60]|\$\(|(?:\s-c|\beval)\s+["'])\s*(?:(?:sudo|env|command|exec|nohup|time|nice|xargs|builtin)\s+(?:-\S+\s+)*)*(?:[A-Za-z_]\w*=\S*\s+)*(?:\S*/)?`;
/** git and its global options (`-C dir`, `-c key=value`, `--no-pager`), up to the subcommand. */
const GIT = String.raw`${CMD}git(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+`;
/** gh and its global options (`-R owner/repo`), up to the subcommand. */
const GH = String.raw`${CMD}gh(?:\s+(?:-R|--repo)\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+`;
/** The rest of the same simple command. */
const ARGS = String.raw`[^;&|\n]*`;
/** A command word ends at a space, the end, or a shell operator. */
const END = String.raw`(?=$|[\s;&|)'"\x60])`;

const rule = (
  id: string,
  scope: BashRule['scope'],
  source: string,
  reason: string,
  flags = '',
): BashRule => ({
  id,
  scope,
  pattern: new RegExp(source, flags),
  reason,
});

export const BASH_RULES: readonly BashRule[] = [
  rule(
    'push-main',
    'everyone',
    String.raw`${GIT}push\b${ARGS}(?:\s|:|\+)["']?(?:refs/heads/)?main["']?${END}`,
    'pushing to main is not allowed; open a PR and merge it through the merge gate',
  ),
  rule(
    'force-push',
    'everyone',
    String.raw`${GIT}push\b${ARGS}(?:\s--force(?:-with-lease|-if-includes)?\b|\s--mirror\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s["']?\+\S)`,
    'force pushes and mirror pushes are not allowed',
  ),
  rule(
    'no-verify',
    'everyone',
    String.raw`${GIT}(?:commit\b${ARGS}(?:\s--no-verify\b|\s-[a-zA-Z]*n[a-zA-Z]*\b)|(?:push|merge|rebase|am|cherry-pick)\b${ARGS}\s--no-verify\b)`,
    'skipping git hooks (--no-verify, or -n on commit) is not allowed',
  ),
  rule(
    'pipe-to-shell',
    'everyone',
    String.raw`\b(?:curl|wget)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:\S*/)?(?:sh|bash|zsh|dash|ksh|node|python3?|perl|ruby)${END}|${CMD}(?:sh|bash|zsh)\s+(?:-\S+\s+)*(?:<\(|["']?\$\()\s*(?:curl|wget)\b`,
    'running a downloaded script (curl … | sh) is not allowed; ask Zeus',
  ),
  rule(
    'publish',
    'everyone',
    String.raw`${CMD}(?:npm|pnpm|yarn|bun)(?:\s+--?[\w-]+(?:[= ]\S+)?)*\s+publish${END}`,
    'publishing packages is not allowed',
  ),
  rule(
    'repo-delete',
    'everyone',
    String.raw`${GH}repo\s+delete\b`,
    'deleting a repository is not allowed',
  ),
  rule(
    'gh-merge',
    'everyone',
    String.raw`${GH}(?:pr\s+merge\b|api\b${ARGS}merge)`,
    'merges go only through scripts/merge-gate.ts',
    'i',
  ),
  rule(
    'builder-git-push',
    'builder',
    String.raw`${GIT}push\b`,
    'builders never push; Athena ships the branch with scripts/ship.ts',
  ),
  rule(
    'builder-gh',
    'builder',
    String.raw`${CMD}gh${END}`,
    'builders have no GitHub access; write what you need in .lzp/pr.md',
  ),
  rule(
    'builder-keychain',
    'builder',
    String.raw`${CMD}security${END}`,
    'builders never touch the Keychain',
  ),
  rule(
    'builder-docker',
    'builder',
    String.raw`${CMD}(?:docker|docker-compose|podman)${END}|docker\.sock`,
    'builders have no Docker; dispatch starts the task’s services',
  ),
  rule(
    'builder-env-file',
    'builder',
    String.raw`(?:^|[\s<>=:'"(])(?:\S*/)?\.env(?:rc|\.(?!example(?=$|[\s;&|)'"\x60>]))[\w.-]+)?(?=$|[\s;&|)'"\x60>])`,
    'builders never read or write .env files (only .env.example)',
    'i',
  ),
];

export interface BashHit {
  rule: BashRule;
}

export function checkBash(command: string, role: Role): BashHit | null {
  for (const r of BASH_RULES) {
    if (r.scope === 'builder' && role !== 'builder') continue;
    if (r.pattern.test(command)) return { rule: r };
  }
  return null;
}
