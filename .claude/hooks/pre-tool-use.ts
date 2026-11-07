#!/usr/bin/env node
// PreToolUse, every tool (§20 section 3): the freeze switch, then Bash rules, then edit rules.
// Registered with "onFailure": "block", so a crash here blocks the tool call instead of letting it through.
import { join } from 'node:path';
import { checkBash } from './lib/bash-rules.ts';
import { checkEdit, editChange, EDIT_TOOLS } from './lib/edit-check.ts';
import { decideFreeze } from './lib/freeze.ts';
import {
  denyTool,
  logHit,
  projectDir,
  readInput,
  readText,
  role,
  stateDir,
} from './lib/hook-io.ts';
import { protectedPatterns } from './lib/paths.ts';

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

function main(): void {
  const input = readInput();
  const who = role();
  const tool = input.tool_name ?? '';
  const block = (rule: string, reason: string, detail?: string): void => {
    logHit(input, {
      hook: 'PreToolUse',
      rule,
      reason,
      tool,
      ...(detail === undefined ? {} : { detail }),
    });
    denyTool(reason);
  };

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
    return;
  }
  if (EDIT_TOOLS.has(tool)) {
    const change = editChange(tool, toolInput, (file) => readText(file));
    const hit = checkEdit(change, {
      role: who,
      projectDir: projectDir(input),
      protectedPaths: who === 'builder' ? builderPatterns() : [],
    });
    if (hit) block(hit.id, hit.reason, change.file);
  }
}

main();
