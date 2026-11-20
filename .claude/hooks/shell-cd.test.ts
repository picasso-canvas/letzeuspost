import { describe, expect, it } from 'vitest';
import { changesDirectory } from './lib/shell-cd.ts';

// A top-level `cd` moves the Bash tool's shell for the calls after it, and `Edit(./**)` is judged against that shell's
// directory (#284): every write outside the folder is then refused. These find a `cd` that would stay.
describe('changesDirectory (#284)', () => {
  const stays = [
    'cd packages/db',
    'cd',
    'cd packages/db && pnpm test',
    'git status; cd x',
    'ls\ncd x',
    'ls | cd x',
    'ls || cd x',
    'if true; then cd x; fi',
    'for f in a b; do cd $f; done',
    '{ cd x; }',
    'pushd x',
    'popd',
    'builtin cd x',
    'command cd x',
    'FOO=1 cd x',
    'echo hi 2>&1; cd x',
    "eval 'cd x'",
    'eval "cd x && ls"',
    'cat > a.md <<EOF\nnotes\nEOF\ncd x',
    'echo "done" && cd x',
    'echo \'it\'"s" && cd x',
  ];
  const stays_ = stays.map((c) => [c] as const);
  it.each(stays_)('finds the cd in %j', (command) => {
    expect(changesDirectory(command)).toBe(true);
  });

  const leaves = [
    '(cd packages/db && pnpm test)',
    'echo $(cd x && pwd)',
    'echo `cd x; pwd`',
    '(\n  cd x\n  ls\n)',
    'git -C packages/db status',
    'pnpm --filter @lzp/db test',
    'echo "cd x"',
    "grep 'cd x' file",
    'echo cd x',
    'cat cdrom.txt',
    'abcd x',
    'ls cd',
    'sh -c "cd x && ls"',
    "bash -c 'cd x; pwd'",
    'git commit -m "cd into the folder"',
    'pnpm exec vitest run cd.test.ts',
    "cat > notes.md <<'EOF'\ncd packages/db\nthen run it\nEOF\nls",
    'cat <<-EOF > a.md\n\tcd x\n\tEOF\nls',
    'cat <<"END"\ncd x\nEND',
    'ls # cd x',
    'git status && git log --oneline -5',
    '',
  ];
  it.each(leaves.map((c) => [c] as const))('lets %j through', (command) => {
    expect(changesDirectory(command)).toBe(false);
  });

  it('reads a heredoc to its delimiter only, and what follows is checked again', () => {
    expect(changesDirectory("cat <<'EOF'\ncd x\nEOF\ncd y")).toBe(true);
    expect(changesDirectory("cat <<'EOF'\ncd x\nEOF\nls")).toBe(false);
    // A `<<` that starts no heredoc (a here-string, an arithmetic shift) hides nothing.
    expect(changesDirectory('cat <<< hi; cd x')).toBe(true);
    expect(changesDirectory('echo $((1 << 2)); cd x')).toBe(true);
  });

  it('does not stop at a quote or a parenthesis it cannot close', () => {
    expect(changesDirectory("echo 'unclosed; cd x")).toBe(false);
    expect(changesDirectory('echo "unclosed; cd x')).toBe(false);
    expect(changesDirectory('(cd x; ls')).toBe(false);
    expect(changesDirectory('ls); cd x')).toBe(true);
  });
});
