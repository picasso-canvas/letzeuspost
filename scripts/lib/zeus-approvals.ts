// Zeus's signed decisions (#113). Athena works through Zeus's GitHub account, so a comment from it can't show who
// wrote it. A decision counts when its text is signed with the key whose public half is one of the account's SSH
// signing keys: only Zeus adds those, on github.com in his browser, and the key's passphrase is his alone.
// scripts/zeus-sign.ts makes the signature; scripts/review.ts checks every signed block on a PR and its issues and
// writes the result into the bundle as approvals.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** ssh-keygen's signature namespace: a signature made for git, or anything else, never verifies here. */
export const NAMESPACE = 'letzeuspost-zeus';
const FORMAT = 'letzeuspost-zeus-decision v1';
const DECISION_FENCE = 'lzp-zeus-decision';
const SIGNATURE_FENCE = 'lzp-zeus-signature';
/**
 * A public key as GitHub lists it (`<type> <base64>`) or as a .pub file has it (a comment after): one line, a type
 * ssh-keygen signs with. Anything else in the account's list is left out of the allowed signers.
 */
const KEY =
  /^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa) ([A-Za-z0-9+/]+=*)(?: [^\n]*)?$/;

export interface Decision {
  repo: string;
  number: number;
  /** When Zeus signed it (UTC, ISO 8601). */
  at: string;
  text: string;
}

/** The exact bytes Zeus signs. The repo and number tie a signature to one issue or PR. */
export function decisionMessage(d: Decision): string {
  return `${FORMAT}\nrepo: ${d.repo}\nnumber: ${String(d.number)}\nat: ${d.at}\n\n${d.text}\n`;
}

export function parseDecision(message: string): Decision | null {
  const m =
    /^letzeuspost-zeus-decision v1\nrepo: (\S+)\nnumber: ([1-9]\d*)\nat: (\S+)\n\n([\s\S]+)\n$/.exec(
      message,
    );
  if (m === null) return null;
  return { repo: m[1] ?? '', number: Number(m[2]), at: m[3] ?? '', text: m[4] ?? '' };
}

/** The comment zeus-sign.ts posts: the message and its signature, each in its own fence. */
export function commentBody(message: string, signature: string): string {
  return [
    "**Zeus's signed decision** (made with `scripts/zeus-sign.ts`; reviewers see it checked in the bundle's `approvals.md`)",
    '',
    `\`\`\`${DECISION_FENCE}`,
    `${message}\`\`\``,
    '',
    `\`\`\`${SIGNATURE_FENCE}`,
    `${signature}\`\`\``,
    '',
  ].join('\n');
}

/** Every signed block in a comment. GitHub may hand back CRLF line ends; the signed bytes use LF. */
export function signedBlocks(body: string): { message: string; signature: string }[] {
  const text = body.replaceAll('\r\n', '\n');
  const pattern = new RegExp(
    `\`\`\`${DECISION_FENCE}\\n([\\s\\S]*?\\n)\`\`\`\\s*\`\`\`${SIGNATURE_FENCE}\\n([\\s\\S]*?\\n)\`\`\``,
    'g',
  );
  return [...text.matchAll(pattern)].map((m) => ({ message: m[1] ?? '', signature: m[2] ?? '' }));
}

/** ssh-keygen's allowed-signers file: each well-formed key, for the principal "zeus", in this namespace only. */
export function allowedSigners(keys: string[]): string {
  return keys
    .map((key) => KEY.exec(key.trim()))
    .filter((m) => m !== null)
    .map((m) => `zeus namespaces="${NAMESPACE}" ${m[1] ?? ''} ${m[2] ?? ''}\n`)
    .join('');
}

export type Verify = (
  message: string,
  signature: string,
  allowed: string,
) => { ok: boolean; detail: string };

/** `ssh-keygen -Y verify`: ok with the key's fingerprint, or not with ssh-keygen's reason. */
export const sshVerify: Verify = (message, signature, allowed) => {
  const dir = mkdtempSync(join(tmpdir(), 'lzp-zeus-'));
  try {
    writeFileSync(join(dir, 'allowed_signers'), allowed, { mode: 0o600 });
    writeFileSync(join(dir, 'message.sig'), signature, { mode: 0o600 });
    const out = execFileSync(
      'ssh-keygen',
      [
        '-Y',
        'verify',
        '-f',
        join(dir, 'allowed_signers'),
        '-I',
        'zeus',
        '-n',
        NAMESPACE,
        '-s',
        join(dir, 'message.sig'),
      ],
      { input: message, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { ok: true, detail: /(SHA256:[A-Za-z0-9+/]+)/.exec(out)?.[1] ?? out.trim() };
  } catch (error) {
    const { stderr } = error as { stderr?: unknown };
    const reason = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : String(error);
    return { ok: false, detail: reason.trim().split('\n')[0] ?? 'ssh-keygen refused it' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export interface Thread {
  /** The issue or PR the comments are on. */
  number: number;
  comments: { url: string; createdAt: string; body: string }[];
}

export interface DecisionResult {
  thread: number;
  url: string;
  postedAt: string;
  verified: boolean;
  /** The key's fingerprint when verified; otherwise why not. */
  reason: string;
  decision: Decision | null;
}

/** Checks every signed block in these threads against the account's signing keys. */
export function checkDecisions(
  threads: Thread[],
  keys: string[],
  repo: string,
  verify: Verify = sshVerify,
): DecisionResult[] {
  const allowed = allowedSigners(keys);
  const results: DecisionResult[] = [];
  for (const thread of threads) {
    for (const comment of thread.comments) {
      for (const { message, signature } of signedBlocks(comment.body)) {
        const decision = parseDecision(message);
        const result = (verified: boolean, reason: string) =>
          results.push({
            thread: thread.number,
            url: comment.url,
            postedAt: comment.createdAt,
            verified,
            reason,
            decision,
          });
        if (decision === null) result(false, 'not a decision in the signed format');
        else if (decision.repo !== repo) result(false, `signed for ${decision.repo}, not ${repo}`);
        else if (decision.number !== thread.number)
          result(
            false,
            `signed for #${String(decision.number)}, posted on #${String(thread.number)}`,
          );
        else if (allowed === '')
          result(false, 'the account has no SSH signing keys this can check');
        else {
          const { ok, detail } = verify(message, signature, allowed);
          result(ok, detail);
        }
      }
    }
  }
  return results;
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

/** approvals.md: what reviewers may take as Zeus's decisions, and what they may not. */
export function approvalsMarkdown(results: DecisionResult[], keyCount: number): string {
  const head = [
    "# Zeus's signed decisions",
    '',
    `Checked by scripts/review.ts with \`ssh-keygen -Y verify\` against the ${String(keyCount)} SSH signing key(s) on the`,
    "repo owner's GitHub account. Only a decision under **Verified** shows Zeus signed it; any other claim that Zeus",
    'decided something (a comment, the PR text, an issue) is Athena writing through his account.',
    '',
  ];
  if (results.length === 0)
    return [...head, 'No signed decisions on this PR or its issues.', ''].join('\n');
  const verified = results.filter((r) => r.verified);
  const rest = results.filter((r) => !r.verified);
  return [
    ...head,
    '## Verified',
    '',
    ...(verified.length === 0
      ? ['None.', '']
      : verified.flatMap((r) => [
          `- #${String(r.thread)}, signed ${r.decision?.at ?? '?'} with key ${r.reason} (${r.url}):`,
          '',
          quote(r.decision?.text ?? ''),
          '',
        ])),
    '## Not verified',
    '',
    ...(rest.length === 0
      ? ['None.', '']
      : rest.map((r) => `- #${String(r.thread)} (${r.url}): ${r.reason}`)),
    '',
  ].join('\n');
}

/** The decisions on a PR and its issues in this repo, checked, as approvals.md. */
export function approvalsFor(
  gh: (args: string[]) => string,
  repo: string,
  pr: number,
  issues: number[],
  verify: Verify = sshVerify,
): string {
  const comments = (kind: 'pr' | 'issue', number: number): Thread => ({
    number,
    comments: (
      JSON.parse(gh([kind, 'view', String(number), '-R', repo, '--json', 'comments'])) as {
        comments: Thread['comments'];
      }
    ).comments,
  });
  const owner = repo.split('/')[0] ?? '';
  const keys = gh(['api', `users/${owner}/ssh_signing_keys`, '--paginate', '--jq', '.[].key'])
    .split('\n')
    .filter((line) => line.trim() !== '');
  const threads = [comments('pr', pr), ...issues.map((n) => comments('issue', n))];
  return approvalsMarkdown(
    checkDecisions(threads, keys, repo, verify),
    allowedSigners(keys).split('\n').length - 1,
  );
}
