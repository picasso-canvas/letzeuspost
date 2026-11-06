# LetZeusPost

A SaaS for agencies: on-brand social posts (English + Bangla) that AI plans, writes, designs and checks, that people
edit and approve, and that are exported ready to schedule. The owner is **Zeus**. Status: **planning**. See
[docs/plan/00-roadmap.md](docs/plan/00-roadmap.md).

## Source of truth

- `docs/plan/` is the plan: one doc per section. The roadmap lists every section and its status.
- Build only from sections whose status is **Approved**. `docs/plan/drafts/` and `docs/plan/research/` are input
  for planning, never a spec. The stack, repo layout, data model and sensitive paths are in
  [§13](docs/plan/13-architecture.md); where another section differs, §13 wins.
- The [GitHub Project **LetZeusPost**](https://github.com/users/picasso-canvas/projects/2) tracks every section
  (issues #1–#23, issue number = section number) and build task in its **Status** field (the stage).
  Its IDs are in `.claude/board-ids.json`. Athena updates it with the `board` skill (`.claude/skills/board/`);
  builder agents can't reach it.
- How building works is planned in Part F: [19 team and workflow](docs/plan/19-build-team-and-workflow.md),
  [20 guardrails](docs/plan/20-builder-guardrails.md), [21 design workflow](docs/plan/21-ai-design-workflow.md),
  [22 product AI guardrails](docs/plan/22-product-ai-guardrails.md).

## Harness first

No product code is written until every section is approved. The first build milestone is **H0 Harness**: the
minimum guardrails in section 20 (repo-only agent token, sandbox, settings, hooks, H0 checks, the risk gate, agent
files, the core skills). It must pass its red-team checklist before any other milestone starts.

## Building

1. Take only issues labelled `build-task` whose Status is **Ready to build**.
2. Work in your own worktree, through the repo-only agent token. Read the issue, the section doc(s) it links, and the
   sections those depend on. Post a 3–5 line approach comment.
3. Tests first for logic. Run `pnpm check` until it is green. Every item in the issue's **Done when** list must pass.
4. Local reviews: Argus (code) always; Cerberus (security) when the diff touches a sensitive area; Iris (design) when
   it touches UI (from the first UI milestone). Fix blocking findings; after 3 rounds, add `needs-zeus` and stop.
5. One issue → one branch `<issue-number>-<short-slug>` → one pull request that says `Closes #<n>`, carries an
   `Agent: <your name>` line, links the section doc, and shows how each Done-when item was checked (command output,
   screenshots for UI). End every commit with a `Co-Authored-By: Claude` line.

## Merging

- **Zeus merges every PR.** Agents never merge, never push to `main`, and never force-push.
- CI labels each PR `routine` or `sensitive`. Sensitive areas: auth, permissions and billing · database schema and
  migrations · dependencies and lockfiles · AI prompts, model/provider config and product AI rules · the guardrails
  themselves (`.github/`, `.claude/`, every `CLAUDE.md`, lint/TS/test configs, `DESIGN.md`, approved visual baselines,
  `docs/plan/`). Never touch those labels.
- Never weaken a guardrail, skip or silence a check, or work around a block. If a guardrail is in the way, comment on
  the issue, add `needs-zeus`, and stop.
- **Freeze switch:** if the repo variable `AGENTS_PAUSED` is true, stop all work at once.

## When the plan doesn't say

Comment on the issue with the question and the options you see, add the `needs-zeus` label, and stop work on that
task. Never guess a product decision, and never change an approved doc without Zeus's OK.

## Never without Zeus's OK

Paid services, sign-ups, new API keys, `curl … | sh` installers, deploys, domain purchases, and adding or updating
skills, agents, plugins or MCP servers. Never read or commit secrets: `.env` files stay local.

## Product principles (from [Section 1](docs/plan/01-product-spec.md))

1. On-brand above everything: colors, fonts, voice and rules come from the brand kit.
2. When text doesn't fit, shorten the words; never shrink the layout.
3. Every fact has a source; claims about a client come from the client's own kit and site.
4. Original only: no meme templates, no copyrighted art; stock images and fonts carry their licence and credit.
5. AI-generated images are labelled synthetic.
6. Bangla is written natively, not translated from English.
7. Nothing reaches the client before the QC check passes.
