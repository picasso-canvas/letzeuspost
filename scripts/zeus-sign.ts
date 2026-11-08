// Zeus signs a decision (#113), in his own terminal, from a checkout of main, never through Claude Code:
//   node scripts/zeus-sign.ts <issue-or-PR number> "<decision>"
// ssh-keygen asks for the key's passphrase itself; this script never reads, holds or passes it. The signature is checked
// against the account's SSH signing keys before it's posted, as a comment on that issue or PR. Setup:
// docs/ops/zeus-signing.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { isEntryPoint } from './lib/entry.ts';
import {
  allowedSigners,
  commentBody,
  decisionMessage,
  NAMESPACE,
  sshVerify,
} from './lib/zeus-approvals.ts';
import { REPO } from './merge-gate/collect.ts';

/** Zeus's signing key: its public half is a Signing Key on his GitHub account. */
export const KEY_PATH = join(homedir(), '.ssh', 'letzeuspost_zeus');

/** Why this run can't sign, or null. */
export function signRefusal(run: {
  number: string;
  text: string;
  tty: boolean;
  env: NodeJS.ProcessEnv;
}): string | null {
  if (run.env.CLAUDECODE !== undefined)
    return 'this runs inside Claude Code: run it in your own terminal, so only you type the passphrase';
  if (!run.tty)
    return 'no terminal for ssh-keygen to ask the passphrase on: run it in your own terminal';
  if (!/^[1-9]\d*$/.test(run.number)) return `"${run.number}" isn't an issue or PR number`;
  if (run.text.trim() === '') return 'the decision text is empty';
  if (run.text.includes('```'))
    return 'the decision text has ``` in it, which would break the comment';
  if (run.text.includes('\r')) return 'the decision text has a carriage return in it';
  return null;
}

function main(argv: string[]): number {
  const [number = '', ...words] = argv;
  const text = words.join(' ');
  const refusal = signRefusal({
    number,
    text,
    tty: process.stdin.isTTY && process.stderr.isTTY,
    env: process.env,
  });
  if (refusal !== null) {
    console.error(
      `zeus-sign: ${refusal}\nusage: node scripts/zeus-sign.ts <issue-or-PR number> "<decision>"`,
    );
    return 2;
  }
  if (!existsSync(KEY_PATH)) {
    console.error(`zeus-sign: no key at ${KEY_PATH}; set one up first (docs/ops/zeus-signing.md)`);
    return 1;
  }
  const message = decisionMessage({
    repo: REPO,
    number: Number(number),
    at: new Date().toISOString(),
    text,
  });
  const dir = mkdtempSync(join(tmpdir(), 'lzp-zeus-sign-'));
  try {
    const file = join(dir, 'decision.txt');
    writeFileSync(file, message, { mode: 0o600 });
    console.error(`Signing for ${REPO}#${number}:\n\n${text}\n`);
    // ssh-keygen talks to the terminal itself: the passphrase never passes through this process.
    const signed = spawnSync(
      'ssh-keygen',
      ['-q', '-Y', 'sign', '-f', KEY_PATH, '-n', NAMESPACE, file],
      {
        stdio: 'inherit',
      },
    );
    if (signed.status !== 0) {
      console.error('zeus-sign: ssh-keygen did not sign it; nothing was posted');
      return 1;
    }
    const signature = readFileSync(`${file}.sig`, 'utf8');
    const owner = REPO.split('/')[0] ?? '';
    const keys = execFileSync(
      'gh',
      ['api', `users/${owner}/ssh_signing_keys`, '--paginate', '--jq', '.[].key'],
      { encoding: 'utf8' },
    ).split('\n');
    const check = sshVerify(message, signature, allowedSigners(keys));
    if (!check.ok) {
      console.error(
        `zeus-sign: the signature doesn't verify against ${owner}'s SSH signing keys (${check.detail}).\n` +
          `Add ${KEY_PATH}.pub as a Signing Key on github.com first; nothing was posted.`,
      );
      return 1;
    }
    const body = join(dir, 'comment.md');
    writeFileSync(body, commentBody(message, signature), { mode: 0o600 });
    const url = execFileSync(
      'gh',
      [
        'api',
        `repos/${REPO}/issues/${number}/comments`,
        '-F',
        `body=@${body}`,
        '--jq',
        '.html_url',
      ],
      { encoding: 'utf8' },
    ).trim();
    console.log(`Signed with ${check.detail} and posted: ${url}`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
