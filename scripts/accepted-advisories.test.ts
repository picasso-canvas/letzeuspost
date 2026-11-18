import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// osv-scanner.toml ignores an advisory by its id everywhere in the lockfile. These tests keep each accepted advisory
// to the path Zeus accepted it on (#107), so the same package arriving another way, say in a runtime dependency,
// fails `pnpm check` instead of hiding behind the ignore.

const LOCKFILE = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const OSV_CONFIG = readFileSync(new URL('../osv-scanner.toml', import.meta.url), 'utf8');
const WORKSPACE = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');

/** `'@shadcn/registry@0.2.1'` or `shadcn@4.23.0(react@19.3.1)` → its package name. */
function nameOf(key: string): string {
  const bare = key.replace(/^'|'$/g, '');
  return bare.slice(0, bare.indexOf('@', 1));
}

interface Edge {
  from: string; // a package name, or `importer:<path>` for a workspace package
  group: string; // dependencies, devDependencies, optionalDependencies
  to: string;
}

/** Every dependency edge in the lockfile's `importers` and `snapshots` sections. */
function edges(lockfile: string): Edge[] {
  const out: Edge[] = [];
  let section = '';
  let entry = '';
  let group = '';
  for (const line of lockfile.split('\n')) {
    const top = /^(\S[^:]*):\s*$/.exec(line);
    if (top) {
      section = top[1] ?? '';
      continue;
    }
    if (section !== 'importers' && section !== 'snapshots') continue;
    const item = /^ {2}(\S.*):\s*$/.exec(line);
    if (item) {
      const key = item[1] ?? '';
      entry = section === 'importers' ? `importer:${key}` : nameOf(key);
      group = '';
      continue;
    }
    const kind = /^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/.exec(line);
    if (kind) {
      group = kind[1] ?? '';
      continue;
    }
    const dep = /^ {6}('[^']+'|[^\s:]+):/.exec(line);
    if (dep && group !== '') out.push({ from: entry, group, to: (dep[1] ?? '').replace(/'/g, '') });
  }
  return out;
}

const all = edges(LOCKFILE);

/** What keeps GHSA-gcqx-w48m-w2h4's ignore from covering more than Zeus accepted; empty when deepmerge stays put. */
function deepmergeOffPath(lockfile: string): string[] {
  const graph = edges(lockfile);
  const dependents = (name: string): string[] =>
    graph.filter((e) => e.to === name).map((e) => `${e.from} ${e.group}`);
  const problems: string[] = [];
  const through = [...new Set(graph.filter((e) => e.to === 'deepmerge').map((e) => e.from))].sort();
  if (through.length === 0)
    problems.push('deepmerge is gone: remove its ignore from osv-scanner.toml and this test');
  else if (JSON.stringify(through) !== JSON.stringify(['@shadcn/registry', 'shadcn']))
    problems.push(`deepmerge comes through ${through.join(', ')}`);
  if (JSON.stringify(dependents('@shadcn/registry')) !== JSON.stringify(['shadcn dependencies']))
    problems.push(`@shadcn/registry is used by ${dependents('@shadcn/registry').join(', ')}`);
  if (
    JSON.stringify(dependents('shadcn')) !==
    JSON.stringify(['importer:packages/ui devDependencies'])
  )
    problems.push(`shadcn is used by ${dependents('shadcn').join(', ')}`);
  return problems;
}

describe('accepted advisories stay on their accepted path', () => {
  it('reads the lockfile (the parser finds the edges it relies on, in both sections)', () => {
    expect(all.some((e) => e.from === 'importer:packages/ui' && e.to === 'react')).toBe(true);
    expect(all.some((e) => e.from === 'importer:.' && e.group === 'devDependencies')).toBe(true);
    expect(all.filter((e) => !e.from.startsWith('importer:')).length).toBeGreaterThan(100);
  });

  it('GHSA-gcqx-w48m-w2h4: deepmerge comes only through the shadcn CLI, a dev dependency of packages/ui', () => {
    expect(OSV_CONFIG).toContain('id = "GHSA-gcqx-w48m-w2h4"');
    expect(deepmergeOffPath(LOCKFILE)).toEqual([]);
  });

  it('catches deepmerge arriving another way, and shadcn becoming a runtime dependency', () => {
    const viaRuntime = `${LOCKFILE}\n  some-runtime-lib@1.0.0:\n    dependencies:\n      deepmerge: 4.3.1\n`;
    expect(deepmergeOffPath(viaRuntime)).toEqual([
      'deepmerge comes through @shadcn/registry, shadcn, some-runtime-lib',
    ]);
    const shadcnAtRuntime = LOCKFILE.replace(
      /(\n {2}packages\/ui:\n {4}dependencies:\n)/,
      '$1      shadcn:\n        specifier: 4.23.0\n        version: 4.23.0\n',
    );
    expect(shadcnAtRuntime).not.toBe(LOCKFILE);
    expect(deepmergeOffPath(shadcnAtRuntime)).toEqual([
      'shadcn is used by importer:packages/ui dependencies, importer:packages/ui devDependencies',
    ]);
  });
});

/** Package names a workspace package's runtime (`dependencies`, `optionalDependencies`) reaches, through the lockfile. */
function reachedAtRuntime(lockfile: string): Set<string> {
  const graph = edges(lockfile);
  const seen = new Set<string>();
  const queue = graph
    .filter((e) => e.from.startsWith('importer:') && e.group !== 'devDependencies')
    .map((e) => e.to);
  while (queue.length > 0) {
    const name = queue.pop() ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    for (const e of graph) if (e.from === name) queue.push(e.to);
  }
  return seen;
}

describe('GHSA-fc5q-39xc-vjpf (picomatch) stays on its accepted path', () => {
  it('is accepted in osv-scanner.toml', () => {
    expect(OSV_CONFIG).toContain('id = "GHSA-fc5q-39xc-vjpf"');
  });

  it('picomatch is reached only through dev dependencies, never at runtime', () => {
    expect(all.some((e) => e.to === 'picomatch')).toBe(true);
    expect(reachedAtRuntime(LOCKFILE).has('picomatch')).toBe(false);
  });

  it('catches picomatch arriving through a runtime dependency', () => {
    const viaRuntime = LOCKFILE.replace(
      /(\n {2}packages\/ui:\n {4}dependencies:\n)/,
      '$1      some-runtime-lib:\n        specifier: 1.0.0\n        version: 1.0.0\n',
    ).concat('\n  some-runtime-lib@1.0.0:\n    dependencies:\n      picomatch: 4.0.7\n');
    expect(viaRuntime).not.toBe(LOCKFILE);
    expect(reachedAtRuntime(viaRuntime).has('picomatch')).toBe(true);
  });
});

/** The ids under `audit.ignore` in pnpm-workspace.yaml (the list `pnpm audit` skips). */
function auditIgnored(workspace: string): string[] {
  const block = /^audit:\n {2}ignore:\n((?: {4}.*\n|\n)*)/m.exec(workspace)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => /^ {4}- (GHSA-[\w-]+)\s*$/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

/** When osv-scanner.toml stops accepting `id`; null when it doesn't accept it. */
function acceptedUntil(osv: string, id: string): Date | null {
  const entry = osv.split('[[IgnoredVulns]]').find((part) => part.includes(`id = "${id}"`));
  const until = /ignoreUntil = (\S+)/.exec(entry ?? '')?.[1];
  return until === undefined ? null : new Date(until);
}

/** What keeps `pnpm audit`'s own ignore list inside what Zeus accepted: each id needs a live OSV entry (#262). */
function auditIgnoreProblems(workspace: string, osv: string, now: Date): string[] {
  return auditIgnored(workspace).flatMap((id) => {
    const until = acceptedUntil(osv, id);
    if (until === null) return [`${id} is in audit.ignore but has no entry in osv-scanner.toml`];
    if (until.getTime() <= now.getTime())
      return [`${id}'s acceptance ended on ${until.toISOString().slice(0, 10)}: look at it again`];
    return [];
  });
}

describe('pnpm audit ignores only what osv-scanner.toml still accepts (#262)', () => {
  it('lists GHSA-fc5q-39xc-vjpf, and every id in it is accepted until a date still ahead', () => {
    expect(auditIgnored(WORKSPACE)).toContain('GHSA-fc5q-39xc-vjpf');
    expect(auditIgnoreProblems(WORKSPACE, OSV_CONFIG, new Date())).toEqual([]);
  });

  it('catches an id with no OSV entry, and an acceptance whose date has passed', () => {
    const extra = WORKSPACE.replace(
      '    - GHSA-fc5q-39xc-vjpf',
      '    - GHSA-fc5q-39xc-vjpf\n    - GHSA-0000-0000-0000',
    );
    expect(auditIgnoreProblems(extra, OSV_CONFIG, new Date())).toEqual([
      'GHSA-0000-0000-0000 is in audit.ignore but has no entry in osv-scanner.toml',
    ]);
    const later = new Date('2026-12-08T00:00:01Z');
    expect(auditIgnoreProblems(WORKSPACE, OSV_CONFIG, later)).toEqual([
      "GHSA-fc5q-39xc-vjpf's acceptance ended on 2026-12-08: look at it again",
    ]);
  });

  it('refuses a list it cannot read, rather than skipping what pnpm would still ignore (Cerberus F1)', () => {
    for (const line of [
      '    - "GHSA-0000-0000-0000"',
      '    - GHSA-0000-0000-0000 reviewed',
      '  ignore: [GHSA-0000-0000-0000]',
      '      - GHSA-0000-0000-0000',
      '  ignorePrune: true',
    ]) {
      const odd = WORKSPACE.replace(
        '    - GHSA-fc5q-39xc-vjpf',
        `    - GHSA-fc5q-39xc-vjpf\n${line}`,
      );
      const problems = auditIgnoreProblems(odd, OSV_CONFIG, new Date());
      expect(
        problems.some((p) => p.includes('unreadable')),
        line,
      ).toBe(true);
    }
    // A comment, a blank line and a trailing comment are fine.
    const fine = WORKSPACE.replace(
      '    - GHSA-fc5q-39xc-vjpf',
      '    - GHSA-fc5q-39xc-vjpf # the picomatch one\n\n    # note',
    );
    expect(auditIgnoreProblems(fine, OSV_CONFIG, new Date())).toEqual([]);
  });

  it('refuses an ignoreUntil it cannot read, and an id that only appears in another reason (Cerberus F2, F3)', () => {
    const typo = OSV_CONFIG.replace('ignoreUntil = 2026-12-08T00:00:00Z', 'ignoreUntil = soon');
    expect(auditIgnoreProblems(WORKSPACE, typo, new Date()).join(' ')).toMatch(
      /GHSA-fc5q-39xc-vjpf.*date/,
    );
    const borrowed = [
      '[[IgnoredVulns]]',
      'id = "GHSA-aaaa-aaaa-aaaa"',
      'ignoreUntil = 2027-01-01T00:00:00Z',
      'reason = "id = \\"GHSA-fc5q-39xc-vjpf\\" is a different one"',
    ].join('\n');
    const osv = OSV_CONFIG.replace(/\[\[IgnoredVulns\]\]\nid = "GHSA-fc5q[\s\S]*$/, '') + borrowed;
    expect(auditIgnoreProblems(WORKSPACE, osv, new Date())).toEqual([
      'GHSA-fc5q-39xc-vjpf is in audit.ignore but has no entry in osv-scanner.toml',
    ]);
  });
});
