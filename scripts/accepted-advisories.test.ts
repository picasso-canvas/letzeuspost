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
const dependents = (name: string): Edge[] => all.filter((e) => e.to === name);

describe('accepted advisories stay on their accepted path', () => {
  it('reads the lockfile (the parser finds the edges it relies on)', () => {
    expect(all.some((e) => e.from === 'importer:packages/ui' && e.to === 'react')).toBe(true);
    expect(all.some((e) => e.from === 'importer:.' && e.group === 'devDependencies')).toBe(true);
  });

  it('GHSA-gcqx-w48m-w2h4: deepmerge comes only through the shadcn CLI, a dev dependency of packages/ui', () => {
    expect(OSV_CONFIG).toContain('id = "GHSA-gcqx-w48m-w2h4"');
    const through = new Set(dependents('deepmerge').map((e) => e.from));
    expect(
      through.size,
      'deepmerge is gone: remove its ignore from osv-scanner.toml and this test',
    ).toBeGreaterThan(0);
    expect([...through].sort()).toEqual(['@shadcn/registry', 'shadcn']);
    expect(dependents('@shadcn/registry').map((e) => e.from)).toEqual(['shadcn']);
    expect(dependents('shadcn').map((e) => `${e.from} ${e.group}`)).toEqual([
      'importer:packages/ui devDependencies',
    ]);
  });

  it('fails when deepmerge arrives another way', () => {
    const extra = `${LOCKFILE}\n  some-runtime-lib@1.0.0:\n    dependencies:\n      deepmerge: 4.3.1\n`;
    const through = new Set(
      edges(extra)
        .filter((e) => e.to === 'deepmerge')
        .map((e) => e.from),
    );
    expect([...through].sort()).not.toEqual(['@shadcn/registry', 'shadcn']);
  });
});
