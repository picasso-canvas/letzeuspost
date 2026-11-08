// PreToolUse Edit/Write/MultiEdit/NotebookEdit: where a change may land and what it may contain.
import { findSecret, findSilencing, type ContentHit } from './content.ts';
import type { Role } from './freeze.ts';
import { matchesAny, safeTarget } from './paths.ts';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export interface EditChange {
  file: string;
  after: string;
  /** The text being replaced; read only after the target passed its checks. */
  before: () => string;
  /** The file as it is now; read only after the target passed its checks. */
  fileText: () => string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The target file and the text replaced/added, from a tool's input. `current` reads the file as it is now. */
export function editChange(
  tool: string,
  input: Record<string, unknown>,
  current: (file: string) => string | null,
): EditChange {
  const file = str(input.file_path) || str(input.notebook_path);
  const now = (): string => current(file) ?? '';
  switch (tool) {
    case 'Write':
      return { file, after: str(input.content), before: now, fileText: now };
    case 'Edit':
      return {
        file,
        after: str(input.new_string),
        before: () => str(input.old_string),
        fileText: now,
      };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
      return {
        file,
        after: edits.map((e) => str(e.new_string)).join('\n'),
        before: () => edits.map((e) => str(e.old_string)).join('\n'),
        fileText: now,
      };
    }
    default:
      return { file, after: str(input.new_source), before: () => '', fileText: () => '' };
  }
}

export interface EditContext {
  role: Role;
  projectDir: string;
  /** Builder-protected globs; null when the builder settings couldn't be read (builders then fail closed). */
  protectedPaths: readonly string[] | null;
}

export function checkEdit(change: EditChange, ctx: EditContext): ContentHit | null {
  if (change.file === '') return { id: 'edit:no-path', reason: 'the tool call names no file' };
  if (ctx.role === 'builder') {
    if (ctx.protectedPaths === null) {
      return {
        id: 'edit:no-rules',
        reason: 'the builder rules could not be read, so no edit is allowed',
      };
    }
    const target = safeTarget(change.file, ctx.projectDir);
    if ('id' in target) return target;
    if (matchesAny(target.rel, ctx.protectedPaths)) {
      return {
        id: 'edit:protected-path',
        reason: `${target.rel} is a protected harness path; if it must change, write it in .lzp/pr.md under needs-zeus and stop`,
      };
    }
  }
  return (
    findSecret(change.after) ??
    findSilencing(change.file, change.before(), change.after, change.fileText())
  );
}
