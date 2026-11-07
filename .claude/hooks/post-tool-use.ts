#!/usr/bin/env node
// PostToolUse (§20 section 3): format the file an edit changed; stamp the tree after a builder's green `pnpm check`.
// Never blocks and never fails the tool call: a formatting or stamping problem is only skipped.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EDIT_TOOLS } from './lib/edit-check.ts';
import { workingTree } from './lib/git-tree.ts';
import { projectDir, readInput, role, type HookInput } from './lib/hook-io.ts';
import { insideRoot } from './lib/paths.ts';
import { isGreenCheck, stampPath } from './lib/stamp.ts';

const FORMATTED = /\.(?:[cm]?[jt]sx?|json|css|scss|ya?ml|html)$/i;
const NOT_FORMATTED =
  /^(?:docs\/|\.claude\/skills\/vendor\/)|(?:^|\/)(?:node_modules|dist|coverage)\/|(?:^|\/)pnpm-lock\.yaml$/;

/**
 * Builders get Athena's prettier and config from main's checkout ($LZP_HARNESS_DIR), never the clone's: hooks run
 * unsandboxed, and the clone's node_modules (or a config naming plugins) is code the builder could have written.
 */
function format(input: HookInput, file: string): void {
  const root = projectDir(input);
  const rel = insideRoot(file, root);
  if (rel === null || !FORMATTED.test(rel) || NOT_FORMATTED.test(rel)) return;
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
  execFileSync(prettier, [...args, '--write', '--ignore-unknown', '--log-level', 'silent', rel], {
    cwd: root,
    stdio: 'ignore',
    timeout: 20_000,
  });
}

function stamp(input: HookInput, command: string): void {
  if (role() !== 'builder' || !isGreenCheck(command, input.tool_response)) return;
  const root = projectDir(input);
  const path = stampPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      tree: workingTree(root),
      at: new Date().toISOString(),
      session: input.session_id ?? null,
    }) + '\n',
  );
}

function main(): void {
  const input = readInput();
  const tool = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};
  try {
    if (tool === 'Bash' && typeof toolInput.command === 'string') stamp(input, toolInput.command);
    else if (EDIT_TOOLS.has(tool)) {
      const file = toolInput.file_path ?? toolInput.notebook_path;
      if (typeof file === 'string' && file !== '') format(input, file);
    }
  } catch {
    // Skipped, never fatal: the Stop hook and CI still catch an unformatted or unchecked tree.
  }
}

main();
