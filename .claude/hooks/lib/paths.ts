// Protected paths for builders (§20 section 2), read from the builder settings' `Edit(./…)` deny rules so the two
// lists can't drift. Self-contained on purpose: hooks run unsandboxed with Zeus's login, so they import nothing a
// builder could write (no node_modules, no scripts/).
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';

/**
 * Node's glob never lets `*` or `**` match a segment that starts with a dot, and macOS ignores letter case, so both
 * sides are lowercased and leading dots dropped from every segment (same idea as scripts/lib/paths.ts on main).
 * Over-matching (`github/x` matches `.github/**`) fails closed.
 */
function normalise(path: string): string {
  return path
    .toLowerCase()
    .split('/')
    .map((segment) => segment.replace(/^\.+(?=.)/, ''))
    .join('/');
}

/**
 * `Edit(./X)` rules from the builder settings, as globs relative to the repo root. A rule for a file name or a dot
 * folder (`CLAUDE.md`, `tsconfig*.json`, `.claude/**`) applies at any depth, because tools also read nested copies
 * (`packages/x/.npmrc`, `apps/web/CLAUDE.md`); a rule under a plain folder (`scripts/**`, `docs/plan/**`) stays at
 * the root, so `packages/x/scripts/` remains product code.
 */
export function protectedPatterns(builderSettings: unknown): string[] {
  const deny = (builderSettings as { permissions?: { deny?: unknown } } | null)?.permissions?.deny;
  if (!Array.isArray(deny)) throw new Error('builder settings have no permissions.deny list');
  const patterns = new Set<string>();
  for (const rule of deny) {
    if (typeof rule !== 'string') continue;
    const m = /^Edit\(\.\/(.+)\)$/.exec(rule);
    if (!m?.[1]) continue;
    const path = m[1];
    const first = path.split('/')[0] ?? '';
    const anchored = path.includes('/') && !first.startsWith('.');
    patterns.add(anchored ? path : `**/${path}`);
  }
  if (patterns.size === 0) throw new Error('builder settings list no Edit(./…) rules');
  return [...patterns];
}

export function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  const path = normalise(relPath);
  return patterns.some((pattern) => {
    const glob = normalise(pattern);
    // `**/x` also covers `x` at the root.
    return matchesGlob(path, glob) || (glob.startsWith('**/') && matchesGlob(path, glob.slice(3)));
  });
}

/** The real path of `target`, resolving symlinks through the nearest folder that exists. */
export function realTarget(target: string): string {
  let dir = dirname(target);
  const rest = [target.slice(dir.length + 1)];
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(dir.slice(dirname(dir).length + 1));
    dir = dirname(dir);
  }
  return resolve(realpathSync(dir), ...rest);
}

/** `target` relative to `root` (both resolved through symlinks), or null when it lies outside `root`. */
export function insideRoot(target: string, root: string): string | null {
  const abs = realTarget(isAbsolute(target) ? target : resolve(root, target));
  const rel = relative(realpathSync(root), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}
