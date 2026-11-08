# Zeus's signed decisions (#113)

Athena works through Zeus's GitHub account, so a comment from it can't show who wrote it. When a decision has to
reach the reviewers as Zeus's (a change to an approved design or doc, an exception), Zeus signs it with his own key.
`scripts/review.ts` checks every signed decision on the PR and its issues against the SSH signing keys on his GitHub
account, and lists them in the bundle's `approvals.md`. Reviewers count a decision only when it's listed there as
verified.

What makes it his: only Zeus adds signing keys to the account (in his browser; Athena's token has no key scopes), and
only he knows the key's passphrase.

## One-time setup (Zeus, in your own terminal, not in Claude Code)

1. Make the key, with a passphrase you use nowhere else:

   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/letzeuspost_zeus -C "LetZeusPost decisions (Zeus)"
   ```

   Don't add it to ssh-agent or the keychain: no `ssh-add`, and no `UseKeychain` or `AddKeysToAgent` that covers it in
   `~/.ssh/config`. The passphrase is the only thing between the key file and anyone who can read it as you.

2. Add its public half to GitHub as a **signing** key: github.com → Settings → SSH and GPG keys → New SSH key, title
   "LetZeusPost decisions", key type **Signing Key**, and paste what `cat ~/.ssh/letzeuspost_zeus.pub` prints.

3. Check that it's listed: `gh api users/picasso-canvas/ssh_signing_keys --jq '.[].key'`.

## Signing a decision

From a checkout of `main`, in your own terminal:

```sh
node scripts/zeus-sign.ts <issue-or-PR number> "<the decision, in your words>"
```

`ssh-keygen` asks for the passphrase itself; the script never sees it. It refuses to run inside Claude Code or
without a terminal. It checks the signature against your account's signing keys before posting it as a comment on
that issue or PR. The signature covers the repo, the number, the time and the text, so it doesn't verify anywhere
else, and a changed word doesn't verify at all.

## Rules

- Never type the passphrase into Claude Code or any chat. Athena never asks for it.
- If you think the key or its passphrase leaked, delete the signing key on GitHub (every signature made with it stops
  verifying) and make a new one.
- A signed decision records what you decided, like a comment does; it isn't tied to a commit. The PR still goes
  through the reviewers and the merge gate.
