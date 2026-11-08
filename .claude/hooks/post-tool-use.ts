#!/usr/bin/env node
// PostToolUse (§20 section 3): format the file an edit changed; stamp the tree after a builder's green `pnpm check`.
// Never blocks and never fails the tool call: a formatting or stamping problem is only skipped.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EDIT_TOOLS } from './lib/edit-check.ts';
import { formatFile } from './lib/format.ts';
import { workingTree } from './lib/git-tree.ts';
import { projectDir, readInput, role, type HookInput } from './lib/hook-io.ts';
import { safeTarget } from './lib/paths.ts';
import { isGreenCheck, stampedTree, writeStamp } from './lib/stamp.ts';

const FORMATTED = /\.(?:[cm]?[jt]sx?|json|css|scss|ya?ml|html)$/i;
const NOT_FORMATTED =
  /^(?:docs\/|\.claude\/skills\/vendor\/)|(?:^|\/)(?:node_modules|dist|coverage)\/|(?:^|\/)pnpm-lock\.yaml$/;

/**
 * Builders get Athena's prettier and config from main's checkout ($LZP_HARNESS_DIR), never the clone's: hooks run
 * unsandboxed, and the clone's node_modules (or a config naming plugins) is code the builder could have written.
 * prettier only formats text from stdin (the path is a name for its parser and ignore file, never an option, never
 * written to); formatFile reads and writes the file itself, so a link swapped in mid-format can't redirect the write.
 */
function format(input: HookInput, file: string): void {
  const root = projectDir(input);
  const target = safeTarget(file, root);
  if ('id' in target) return;
  const rel = target.rel;
  if (
    !FORMATTED.test(rel) ||
    NOT_FORMATTED.test(rel) ||
    rel.split('/').some((s) => s.startsWith('-'))
  )
    return;
  const harness = process.env.LZP_HARNESS_DIR;
  const builder = role() === 'builder';
  if (builder && !harness) return;
  const home = builder && harness ? harness : root;
  const prettier = join(home, 'node_modules', '.bin', 'prettier');
  if (!existsSync(prettier)) return;
  const args = builder
    ? [
        '--config',
        join(home, '.prettierrc.json'),
        '--no-editorconfig',
        '--ignore-path',
        join(root, '.prettierignore'),
      ]
    : [];
  const path = join(realpathSync(root), rel);
  formatFile(path, (text) => {
    try {
      return execFileSync(prettier, [...args, '--stdin-filepath', path], {
        cwd: root,
        input: text,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 20_000,
      });
    } catch {
      return null;
    }
  });
}

function stamp(input: HookInput, toolInput: Record<string, unknown>): void {
  const harness = process.env.LZP_HARNESS_DIR;
  if (role() !== 'builder' || !harness || typeof toolInput.command !== 'string') return;
  const root = projectDir(input);
  const run = {
    command: toolInput.command,
    background: toolInput.run_in_background === true,
    cwd: input.cwd,
    response: input.tool_response,
  };
  if (!isGreenCheck(run, root, harness)) return;
  // Green only for the tree the check started on (PreToolUse stamped it): a change made while it ran isn't covered.
  const tree = workingTree(root);
  if (tree === stampedTree(root, 'pending'))
    writeStamp(root, 'green', tree, input.session_id ?? null);
}

function main(): void {
  const input = readInput();
  const tool = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};
  try {
    if (tool === 'Bash') stamp(input, toolInput);
    else if (EDIT_TOOLS.has(tool)) {
      const file = toolInput.file_path ?? toolInput.notebook_path;
      if (typeof file === 'string' && file !== '') format(input, file);
    }
  } catch {
    // Skipped, never fatal: the Stop hook and CI still catch an unformatted or unchecked tree.
  }
}

main();
