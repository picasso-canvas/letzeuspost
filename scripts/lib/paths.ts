import { matchesGlob } from 'node:path';

/** Patterns from a list like `.github/sensitive-paths.txt`: separated by whitespace, `#` starts a comment. */
export function parsePatternList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, ''))
    .flatMap((line) => line.split(/\s+/))
    .filter((pattern) => pattern !== '');
}

/**
 * Node's glob never lets `*` or `**` match a segment that starts with a dot, so `packages/auth/.x/a.ts` would
 * escape `packages/auth/**`. Dropping leading dots from every segment of both sides makes dot folders match like
 * any other; the only side effect is over-matching (`github/x` matches `.github/**`), which fails closed.
 */
function normalise(path: string): string {
  return path
    .toLowerCase()
    .split('/')
    .map((segment) => segment.replace(/^\.+(?=.)/, ''))
    .join('/');
}

/** Letter case is ignored too: macOS treats `Claude.md` and `CLAUDE.md` as the same file. */
export function matchesAny(file: string, patterns: readonly string[]): boolean {
  const path = normalise(file);
  return patterns.some((pattern) => matchesGlob(path, normalise(pattern)));
}
