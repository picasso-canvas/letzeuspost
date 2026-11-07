// PreToolUse Edit/Write/MultiEdit/NotebookEdit: where a change may land and what it may contain.
import type { Role } from './freeze.ts';
import { findSecret, findSilencing, type ContentHit } from './content.ts';
import { insideRoot, matchesAny } from './paths.ts';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export interface EditChange {
  file: string;
  before: string;
  after: string;
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
  switch (tool) {
    case 'Write':
      return { file, before: current(file) ?? '', after: str(input.content) };
    case 'Edit':
      return { file, before: str(input.old_string), after: str(input.new_string) };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
      return {
        file,
        before: edits.map((e) => str(e.old_string)).join('\n'),
        after: edits.map((e) => str(e.new_string)).join('\n'),
      };
    }
    default:
      return { file, before: '', after: str(input.new_source) };
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
    let rel: string | null;
    try {
      rel = insideRoot(change.file, ctx.projectDir);
    } catch {
      rel = null;
    }
    if (rel === null) {
      return {
        id: 'edit:outside-clone',
        reason: `builders edit only inside their own clone, not ${change.file}`,
      };
    }
    if (matchesAny(rel, ctx.protectedPaths)) {
      return {
        id: 'edit:protected-path',
        reason: `${rel} is a protected harness path; if it must change, write it in .lzp/pr.md under needs-zeus and stop`,
      };
    }
  }
  return findSecret(change.after) ?? findSilencing(change.file, change.before, change.after);
}
