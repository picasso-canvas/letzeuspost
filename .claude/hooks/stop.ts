#!/usr/bin/env node
// Stop, builders only (§20 section 3): no finishing while the code differs from the last green `pnpm check`.
// Loop guard: when this turn is already continuing because of a Stop block (`stop_hook_active`), let it end. Claude
// Code also ends a turn after 8 blocks in a row; this guard makes it one nudge, not eight.
import { baseTree, workingTree } from './lib/git-tree.ts';
import { logHit, printJson, projectDir, readInput, readText, role } from './lib/hook-io.ts';
import { stampPath } from './lib/stamp.ts';

function stampedTree(root: string): string | null {
  try {
    const value: unknown = JSON.parse(readText(stampPath(root)) ?? 'null');
    const tree = (value as { tree?: unknown } | null)?.tree;
    return typeof tree === 'string' ? tree : null;
  } catch {
    return null;
  }
}

function main(): void {
  const input = readInput();
  if (role() !== 'builder' || input.stop_hook_active === true) return;
  const root = projectDir(input);
  let tree: string;
  try {
    tree = workingTree(root);
  } catch {
    return; // Not a git clone: nothing to compare. CI still runs the check.
  }
  if (tree === baseTree(root) || tree === stampedTree(root)) return;
  const reason =
    'Code changed after the last green `pnpm check`. Run `pnpm check` (exactly that command, no pipes) until it ' +
    'is green, then finish. If you are stopping on purpose (needs-zeus), say so in .lzp/pr.md.';
  logHit(input, { hook: 'Stop', rule: 'stop:unchecked', reason, detail: tree });
  printJson({ decision: 'block', reason });
}

main();
