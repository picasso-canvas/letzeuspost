# LetZeusPost

A SaaS for agencies: on-brand social posts (English + Bangla) that AI plans, writes, designs and checks, that people
edit and approve, and that are exported ready to schedule. The owner is **Zeus**. Status: **planning**. See
[docs/plan/00-roadmap.md](docs/plan/00-roadmap.md).

## Source of truth

- `docs/plan/` is the plan: one doc per section. The roadmap lists every section and its status.
- Build only from sections whose status is **Approved**. `docs/plan/drafts/` is input for planning, never a spec.
- The GitHub Project **LetZeusPost** tracks every section and build task in its **Status** field (the stage).
  Its IDs are in `.claude/board-ids.json`. Update the board with the `board` skill (`.claude/skills/board/`).

## Building

1. Take only issues labelled `build-task` whose Status is **Ready to build**. Move the issue to **In progress**.
2. Read the issue, the section doc(s) it links, and the sections those depend on.
3. One issue → one branch `<issue-number>-<short-slug>` → one pull request. The PR says `Closes #<n>` and links the section doc.
4. Every item in the issue's **Done when** list must pass. The PR description shows how each one was checked
   (commands and their output, screenshots for UI).
5. Move the issue to **In review**. Zeus reviews and merges; a merged PR moves the issue to **Done**.

## When the plan doesn't say

Comment on the issue with the question and the options you see, add the `needs-zeus` label, and stop work on that
task. Never guess a product decision, and never change an approved doc without Zeus's OK.

## Never without Zeus's OK

Paid services, sign-ups, new API keys, `curl … | sh` installers, deploys, and domain purchases. Never commit
secrets: `.env` files stay local.

## Product principles (from [Section 1](docs/plan/01-product-spec.md))

1. On-brand above everything: colors, fonts, voice and rules come from the brand kit.
2. When text doesn't fit, shorten the words; never shrink the layout.
3. Every fact has a source; claims about a client come from the client's own kit and site.
4. Original only: no meme templates, no copyrighted art; stock images and fonts carry their licence and credit.
5. AI-generated images are labelled synthetic.
6. Bangla is written natively, not translated from English.
7. Nothing reaches the client before the QC check passes.
