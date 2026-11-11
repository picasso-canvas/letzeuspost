import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const settings = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as {
    autoMemoryEnabled?: boolean;
    disableClaudeAiConnectors?: boolean;
    env?: Record<string, string>;
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

describe('token budget in this repo (#235, Zeus 2026-11-11)', () => {
  it('compacts every session at 200K tokens, through the env var that beats the user settings and the [1m] model', () => {
    expect(settings('.claude/settings.json').env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('200000');
  });

  it('keeps the 1M context off, so the window above is the whole context', () => {
    expect(settings('.claude/settings.json').env?.CLAUDE_CODE_DISABLE_1M_CONTEXT).toBe('1');
  });

  it("loads no claude.ai connector (MCP servers need Zeus's OK; none is used here)", () => {
    expect(settings('.claude/settings.json').disableClaudeAiConnectors).toBe(true);
  });
});
