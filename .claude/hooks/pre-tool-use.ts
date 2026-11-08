#!/usr/bin/env node
// PreToolUse, every tool (§20 section 3): the freeze switch, then Bash rules, then edit rules.
// Registered with "onFailure": "block": if node itself fails, the call is refused. An error inside the hook refuses a
// builder's call, and lets anyone else's through with a log line, so a hook bug can't lock Athena out.
import { join } from 'node:path';
import { checkBash } from './lib/bash-rules.ts';
import { checkEdit, editChange, EDIT_TOOLS } from './lib/edit-check.ts';
import { decideFreeze } from './lib/freeze.ts';
import { workingTree } from './lib/git-tree.ts';
import {
  denyTool,
  logHit,
  projectDir,
  readInput,
  readPlanted,
  readText,
  role,
  stateDir,
  type HookInput,
} from './lib/hook-io.ts';
import { protectedPatterns } from './lib/paths.ts';
import { isCheckCommand, writeStamp } from './lib/stamp.ts';

function builderPatterns(): string[] | null {
  const harness = process.env.LZP_HARNESS_DIR;
  if (!harness) return null;
  try {
    return protectedPatterns(
      JSON.parse(readText(join(harness, '.claude', 'builder', 'settings.json')) ?? 'null'),
    );
  } catch {
    return null;
  }
}

function check(
  input: HookInput,
  block: (rule: string, reason: string, detail?: string) => void,
): void {
  const who = role();
  const tool = input.tool_name ?? '';
  const freeze = decideFreeze(readText(join(stateDir(), 'paused')), Date.now(), who);
  if (freeze.frozen) {
    block('freeze', freeze.reason);
    return;
  }
  if (who === 'builder' && !process.env.LZP_HARNESS_DIR) {
    block('builder:no-harness', 'a builder session needs LZP_HARNESS_DIR from dispatch; stop');
    return;
  }
  const toolInput = input.tool_input ?? {};
  if (tool === 'Bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    const hit = checkBash(command, who);
    if (hit) block(`bash:${hit.rule.id}`, hit.rule.reason, command);
    else if (who === 'builder' && isCheckCommand(command)) {
      // The tree this check starts on; PostToolUse stamps it green only if the tree is still the same at the end.
      // An unhashable tree just gets no pending stamp: the check runs, and can't stamp green.
      const root = projectDir(input);
      try {
        writeStamp(root, 'pending', workingTree(root), input.session_id ?? null);
      } catch {
        // No pending stamp.
      }
    }
    return;
  }
  if (EDIT_TOOLS.has(tool)) {
    const change = editChange(tool, toolInput, (file) => readPlanted(file));
    const hit = checkEdit(change, {
      role: who,
      projectDir: projectDir(input),
      protectedPaths: who === 'builder' ? builderPatterns() : [],
    });
    if (hit) block(hit.id, hit.reason, change.file);
  }
}

let input: HookInput = {};
try {
  input = readInput();
  check(input, (rule, reason, detail) => {
    logHit(input, {
      hook: 'PreToolUse',
      rule,
      reason,
      tool: input.tool_name ?? '',
      ...(detail === undefined ? {} : { detail }),
    });
    denyTool(reason);
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logHit(input, {
    hook: 'PreToolUse',
    rule: 'hook-error',
    reason: message,
    tool: input.tool_name ?? '',
  });
  if (role() === 'builder')
    denyTool(`the guardrail hook failed (${message}); stop and report it in .lzp/pr.md`);
}
