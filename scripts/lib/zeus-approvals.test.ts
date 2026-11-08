import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  approvalsFor,
  approvalsMarkdown,
  checkDecisions,
  commentBody,
  decisionMessage,
  NAMESPACE,
  parseDecision,
  signedBlocks,
  sshVerify,
  type Thread,
} from './zeus-approvals.ts';

const REPO = 'picasso-canvas/letzeuspost';
const AT = '2026-11-08T17:00:00.000Z';
const TEXT = 'I approve the faint grey #6F6A62 (dark #8C877E).';

// Real keys and real `ssh-keygen -Y sign`, no passphrase: "zeus" stands for the key on the account, "other" for any
// key that isn't (Athena's, say).
let dir = '';
const pub = (name: string) => readFileSync(join(dir, `${name}.pub`), 'utf8').trim();
function sign(name: string, message: string, namespace = NAMESPACE): string {
  const file = join(dir, `msg-${String(Math.random()).slice(2)}`);
  writeFileSync(file, message);
  execFileSync('ssh-keygen', ['-q', '-Y', 'sign', '-f', join(dir, name), '-n', namespace, file]);
  return readFileSync(`${file}.sig`, 'utf8');
}
const thread = (number: number, body: string): Thread => ({
  number,
  comments: [{ url: `https://x/${String(number)}#c1`, createdAt: AT, body }],
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzp-zeus-test-'));
  for (const name of ['zeus', 'other'])
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      name,
      '-f',
      join(dir, name),
    ]);
});

describe('decision messages (#113)', () => {
  it('round-trips a decision through its message and a comment', () => {
    const message = decisionMessage({ repo: REPO, number: 111, at: AT, text: TEXT });
    expect(parseDecision(message)).toEqual({ repo: REPO, number: 111, at: AT, text: TEXT });
    const blocks = signedBlocks(commentBody(message, 'SIG\n'));
    expect(blocks).toEqual([{ message, signature: 'SIG\n' }]);
  });

  it('reads a comment GitHub returns with CRLF line ends', () => {
    const message = decisionMessage({ repo: REPO, number: 111, at: AT, text: TEXT });
    const crlf = commentBody(message, 'SIG\n').replaceAll('\n', '\r\n');
    expect(signedBlocks(crlf)).toEqual([{ message, signature: 'SIG\n' }]);
  });

  it('refuses a message that is not in the format', () => {
    expect(parseDecision('hello')).toBeNull();
    expect(
      parseDecision(
        `letzeuspost-zeus-decision v1\nrepo: ${REPO}\nnumber: x\nat: ${AT}\n\n${TEXT}\n`,
      ),
    ).toBeNull();
  });
});

describe('checkDecisions (#113)', () => {
  const message = () => decisionMessage({ repo: REPO, number: 111, at: AT, text: TEXT });

  it('verifies a decision signed with a key on the account, posted where it was signed for', () => {
    const [result] = checkDecisions(
      [thread(111, commentBody(message(), sign('zeus', message())))],
      [pub('zeus')],
      REPO,
    );
    expect(result?.verified).toBe(true);
    expect(result?.reason).toMatch(/^SHA256:/);
    expect(result?.decision?.text).toBe(TEXT);
  });

  it("doesn't verify a key that isn't on the account", () => {
    const [result] = checkDecisions(
      [thread(111, commentBody(message(), sign('other', message())))],
      [pub('zeus')],
      REPO,
    );
    expect(result?.verified).toBe(false);
  });

  it("doesn't verify a changed text", () => {
    const changed = message().replace('#6F6A62', '#8E8A82');
    const [result] = checkDecisions(
      [thread(111, commentBody(changed, sign('zeus', message())))],
      [pub('zeus')],
      REPO,
    );
    expect(result?.verified).toBe(false);
  });

  it("doesn't verify a block copied to another issue or PR", () => {
    const [result] = checkDecisions(
      [thread(112, commentBody(message(), sign('zeus', message())))],
      [pub('zeus')],
      REPO,
    );
    expect(result?.verified).toBe(false);
    expect(result?.reason).toMatch(/signed for #111, posted on #112/);
  });

  it("doesn't verify a signature for another purpose, or another repo's decision", () => {
    const other = decisionMessage({ repo: 'else/where', number: 111, at: AT, text: TEXT });
    const results = checkDecisions(
      [
        thread(111, commentBody(message(), sign('zeus', message(), 'git'))),
        thread(111, commentBody(other, sign('zeus', other))),
      ],
      [pub('zeus')],
      REPO,
    );
    expect(results.map((r) => r.verified)).toEqual([false, false]);
    expect(results[1]?.reason).toMatch(/else\/where/);
  });

  it('verifies nothing when the account has no signing keys, or only malformed ones', () => {
    const body = commentBody(message(), sign('zeus', message()));
    const none = checkDecisions([thread(111, body)], [], REPO);
    expect(none[0]?.verified).toBe(false);
    expect(none[0]?.reason).toMatch(/no SSH signing keys/);
    const bad = checkDecisions(
      [thread(111, body)],
      [`${pub('zeus')}\nzeus ssh-ed25519 AAAA`],
      REPO,
    );
    expect(bad[0]?.verified).toBe(false);
  });
});

describe('sshVerify', () => {
  it('fails closed on a signature that is not one', () => {
    expect(
      sshVerify('x\n', 'not a signature\n', `zeus namespaces="${NAMESPACE}" ${pub('zeus')}\n`).ok,
    ).toBe(false);
  });
});

describe('approvals.md (#113)', () => {
  it('lists verified decisions apart from the rest, quoting their text', () => {
    const message = decisionMessage({ repo: REPO, number: 111, at: AT, text: TEXT });
    const results = checkDecisions(
      [
        thread(111, commentBody(message, sign('zeus', message))),
        thread(111, commentBody(message, sign('other', message))),
      ],
      [pub('zeus')],
      REPO,
    );
    const md = approvalsMarkdown(results, 1);
    expect(md).toMatch(/## Verified[\s\S]*> I approve the faint grey[\s\S]*## Not verified/);
    expect(md.indexOf('## Not verified')).toBeGreaterThan(md.indexOf('SHA256:'));
  });

  it('says so when there are none', () => {
    expect(approvalsMarkdown([], 1)).toMatch(/No signed decisions/);
  });

  it("reads the PR and its issues, and the keys on the repo owner's account", () => {
    const message = decisionMessage({ repo: REPO, number: 70, at: AT, text: TEXT });
    const calls: string[] = [];
    const gh = (args: string[]) => {
      const joined = args.join(' ');
      calls.push(joined);
      if (joined.startsWith('pr view 111')) return JSON.stringify({ comments: [] });
      if (joined.startsWith('issue view 70'))
        return JSON.stringify({
          comments: [
            {
              url: 'https://x/70#c',
              createdAt: AT,
              body: commentBody(message, sign('zeus', message)),
            },
          ],
        });
      if (joined.startsWith('api users/picasso-canvas/ssh_signing_keys')) return `${pub('zeus')}\n`;
      throw new Error(`unexpected gh ${joined}`);
    };
    const md = approvalsFor(gh, REPO, 111, [70]);
    expect(md).toMatch(/## Verified[\s\S]*#70/);
    expect(calls.some((c) => c.startsWith('api users/picasso-canvas/ssh_signing_keys'))).toBe(true);
  });
});
