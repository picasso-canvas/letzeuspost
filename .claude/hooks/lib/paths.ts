// Protected paths for builders (§20 section 2), read from the builder settings' `Edit(./…)` deny rules so the two
// lists can't drift, plus where an edit may land. Self-contained on purpose: hooks run unsandboxed with Zeus's login,
// so they import nothing a builder could write (no node_modules, no scripts/).
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Paths the hooks protect beyond the settings: a builder must never touch git's own files. */
export const EXTRA_PROTECTED = ['**/.git', '**/.git/**'];

/**
 * A glob as a case-insensitive regular expression (macOS ignores letter case). Unlike Node's matchesGlob, `*` and
 * `**` here also match segments that start with a dot (`scripts/**` covers `scripts/.x/y`), and dots in the pattern
 * match only dots (`.claude/**` doesn't cover `src/claude/`).
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob.charAt(i + 1) === '*') {
      if (glob.charAt(i + 2) === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
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
  return [...patterns, ...EXTRA_PROTECTED];
}

export function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(relPath));
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

/** `target`'s folder resolved through symlinks, relative to `root`, or null when it lies outside `root`. */
export function insideRoot(target: string, root: string): string | null {
  const abs = realTarget(isAbsolute(target) ? target : resolve(root, target));
  const rel = relative(realpathSync(root), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

export type Target = { rel: string } | { id: string; reason: string };

/**
 * Where an unsandboxed tool may write or read on a builder's behalf: inside the clone, and a regular file with one
 * link, or a file that doesn't exist yet. A symlink (even one pointing inside), a hard link, a folder, a FIFO or a
 * device is refused, so nothing the builder planted can redirect the write. (A builder swapping the file between this
 * check and the write is a race the hooks can't close; the builder settings' Edit scope is the other line.)
 */
export function safeTarget(target: string, root: string): Target {
  const abs = isAbsolute(target) ? target : resolve(root, target);
  let rel: string | null;
  try {
    rel = insideRoot(abs, root);
  } catch {
    rel = null;
  }
  if (rel === null)
    return {
      id: 'edit:outside-clone',
      reason: `builders work only inside their own clone, not ${target}`,
    };
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    return { rel };
  }
  if (stat.isSymbolicLink())
    return { id: 'edit:symlink', reason: `${rel} is a symlink; builders edit regular files only` };
  if (!stat.isFile()) return { id: 'edit:not-a-file', reason: `${rel} is not a regular file` };
  if (stat.nlink > 1)
    return {
      id: 'edit:hardlink',
      reason: `${rel} has other hard links; builders edit regular files only`,
    };
  return { rel };
}
