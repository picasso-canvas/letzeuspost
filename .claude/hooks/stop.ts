#!/usr/bin/env node
// Stop, builders only (§20 section 3): no finishing while the tree differs from both the tree the session started
// with and the tree of the last green `pnpm check` (both stamped in ~/.letzeuspost/stamps/, out of the builder's
// reach; never from git refs, which the builder can move).
// Loop guard: when this turn is already continuing because of a Stop block (`stop_hook_active`), let it end. Claude
// Code also ends a turn after 8 blocks in a row; this guard makes it one nudge, not eight.
import { workingTree } from './lib/git-tree.ts';
import { logHit, printJson, projectDir, readInput, role } from './lib/hook-io.ts';
import { stampedTree } from './lib/stamp.ts';

/** Under the Stop and SubagentStop hooks' 60 s timeout in the builder settings. */
const TREE_BUDGET_MS = 40_000;

function main(): void {
  const input = readInput();
  if (role() !== 'builder' || input.stop_hook_active === true) return;
  const root = projectDir(input);
  let tree: string | null;
  try {
    tree = workingTree(root, TREE_BUDGET_MS);
  } catch {
    tree = null;
  }
  if (tree !== null && (tree === stampedTree(root, 'base') || tree === stampedTree(root, 'green')))
    return;
  const reason =
    tree === null
      ? 'The guardrail could not hash your clone, so it cannot confirm a green `pnpm check`. Say so in .lzp/pr.md.'
      : 'Code changed after the last green `pnpm check`. Run `pnpm check` (exactly that command, in the clone root, ' +
        'not in the background) until it is green, then finish. If you are stopping on purpose (needs-zeus), say so ' +
        'in .lzp/pr.md.';
  logHit(input, {
    hook: 'Stop',
    rule: tree === null ? 'stop:no-hash' : 'stop:unchecked',
    reason,
    detail: tree ?? '',
  });
  printJson({ decision: 'block', reason });
}

main();
