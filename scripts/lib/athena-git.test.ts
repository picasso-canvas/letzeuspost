import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { athenaGitEnv } from './athena-git.ts';

describe('athenaGitEnv', () => {
  it("keeps the system git config off and gives github.com Athena's gh login, no other host", () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzp-git-login-'));
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    // A fake gh that answers git's credential request (the real one would hand over Zeus's token).
    writeFileSync(
      join(dir, 'gh'),
      '#!/bin/sh\n[ "$1 $2 $3" = "auth git-credential get" ] && printf "username=athena\\npassword=from-gh\\n"\n',
      { mode: 0o755 },
    );
    const env = athenaGitEnv({
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      HOME: dir, // no ~/.gitconfig of the machine's
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    const fill = (host: string): string =>
      spawnSync('git', ['credential', 'fill'], {
        cwd: dir,
        env,
        input: `protocol=https\nhost=${host}\n\n`,
        encoding: 'utf8',
      }).stdout;
    expect(fill('github.com')).toContain('password=from-gh');
    expect(fill('example.com')).not.toContain('password=from-gh');
  });

  it('keeps the environment and any config entries already given', () => {
    const env = athenaGitEnv({
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.quotePath',
      GIT_CONFIG_VALUE_0: 'false',
    });
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.quotePath',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!gh auth git-credential',
    });
  });
});
