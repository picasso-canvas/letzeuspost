import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const settings = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as {
    autoMemoryEnabled?: boolean;
    permissions?: { deny?: string[] };
  };

describe('auto-memory in this repo', () => {
  it('is off for every session started here (reviewers, builders, Athena), so no note outlives its review', () => {
    expect(settings('.claude/settings.json').autoMemoryEnabled).toBe(false);
  });

  it('keeps every file under ~/.claude/projects denied to the Edit and Write tools', () => {
    expect(settings('.claude/settings.json').permissions?.deny).toContain(
      'Edit(~/.claude/projects/**)',
    );
  });
});
