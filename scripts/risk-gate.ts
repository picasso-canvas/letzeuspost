#!/usr/bin/env node
// The risk gate (§20 part 5): judges a PR `sensitive` or `routine` from its changed paths and `main`'s list.
//   node scripts/risk-gate.ts <sensitive-paths-file> <merge-gate.json> < changed-files (one JSON string per line)
// Prints a JSON verdict. CI runs `main`'s copy of this script on the file list from git, never the PR's code.
// The merge gate (#37) works the tier out the same way and only checks that the label agrees.
import { readFileSync } from 'node:fs';
import { matchesAny, parsePatternList } from './lib/paths.ts';
import { safeName } from './lib/safe-name.ts';

export { safeName };

// The harness paths come from main's .github/merge-gate.json, the same list the merge gate uses.
const DEFAULT_HARNESS = ['.github/**', '.claude/**', 'scripts/**', 'CLAUDE.md', '**/CLAUDE.md'];

export interface Judgement {
  tier: 'sensitive' | 'routine';
  sensitive: string[];
  harness: boolean;
  summary: string;
}

export function judge(
  changedFiles: readonly string[],
  list: string | null,
  harnessPaths: readonly string[] = DEFAULT_HARNESS,
): Judgement {
  if (list === null) {
    return {
      tier: 'sensitive',
      sensitive: [],
      harness: false,
      summary:
        'No sensitive-paths list on `main` yet, so every PR counts as sensitive (fails safe).',
    };
  }
  if (changedFiles.length === 0) {
    return {
      tier: 'sensitive',
      sensitive: [],
      harness: false,
      summary: 'No changed files found (fails safe).',
    };
  }
  const patterns = parsePatternList(list);
  const sensitive = changedFiles.filter((file) => matchesAny(file, patterns));
  const harnessFiles = changedFiles.filter((file) => matchesAny(file, harnessPaths));
  const harness = harnessFiles.length > 0;
  if (sensitive.length === 0) {
    return { tier: 'routine', sensitive, harness, summary: 'No sensitive paths changed.' };
  }
  const shown = sensitive.slice(0, 30).map(safeName);
  if (sensitive.length > 30) shown.push(`… and ${String(sensitive.length - 30)} more`);
  const lines = [
    `**Sensitive:** ${String(sensitive.length)} of ${String(changedFiles.length)} changed files are in sensitive areas (§13).`,
    ...(harness
      ? [
          '**This PR changes the harness:**',
          '```text',
          ...harnessFiles.slice(0, 10).map(safeName),
          ...(harnessFiles.length > 10 ? [`… and ${String(harnessFiles.length - 10)} more`] : []),
          '```',
        ]
      : []),
    '',
    '```text',
    ...shown,
    '```',
    '',
    'Cerberus reviews it before the merge gate passes (§19).',
  ];
  return { tier: 'sensitive', sensitive, harness, summary: lines.join('\n') };
}

/** File names from `gh api …/files --jq '… | @json'`: one JSON string per line, so odd names stay whole. */
export function parseJsonLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const name: unknown = JSON.parse(line);
      if (typeof name !== 'string') throw new Error(`not a file name: ${line}`);
      return name;
    });
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  // usage: node scripts/risk-gate.ts <sensitive-paths-file> <merge-gate.json> < files.jsonl
  const listPath = process.argv[2];
  let list: string | null;
  try {
    list = listPath ? readFileSync(listPath, 'utf8') : null;
  } catch {
    list = null;
  }
  let harnessPaths: string[] = DEFAULT_HARNESS;
  try {
    const config = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf8')) as {
      harnessPaths?: unknown;
    };
    if (Array.isArray(config.harnessPaths)) harnessPaths = config.harnessPaths.map(String);
  } catch {
    // no config on main yet: the defaults
  }
  const verdict = judge(parseJsonLines(readFileSync(0, 'utf8')), list, harnessPaths);
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
}
