import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// osv-scanner.toml ignores an advisory by its id everywhere in the lockfile. These tests keep each accepted advisory
// to the path Zeus accepted it on (#107), so the same package arriving another way, say in a runtime dependency,
// fails `pnpm check` instead of hiding behind the ignore.

const LOCKFILE = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const OSV_CONFIG = readFileSync(new URL('../osv-scanner.toml', import.meta.url), 'utf8');

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
