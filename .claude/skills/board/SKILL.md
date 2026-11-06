---
name: board
description: Update the LetZeusPost GitHub Project board. Use when a planning section changes status, when an approved section is broken into build tasks, when starting, finishing or getting stuck on a build task, when a question needs Zeus, or when writing the weekly audit.
---

# LetZeusPost board (GitHub Projects)

- Repo `picasso-canvas/letzeuspost`. Project **LetZeusPost** #2 (owner `picasso-canvas`):
  https://github.com/users/picasso-canvas/projects/2
- Every ID (project, fields, options, section items, milestones) is in `.claude/board-ids.json`. Read the IDs from
  there and don't look them up again. If an ID fails, rebuild the file with
  `gh project field-list 2 --owner picasso-canvas --format json`.
- Keep calls small: one `gh` call per change, `--jq` to keep only what you need, never print the whole board.
- Building agents use Zeus's `gh` login. They never merge with `--admin` and never set the `zeus-only` /
  `auto-merge` labels (section 20).

## Fields

| Field | Values |
|---|---|
| Status | Not started · Interview · Draft · Approved (sections) · Ready to build · In progress · In review · Done (build tasks) |
| Kind | Section · Build task |
| Part | A Product & business · B Experience · C Engine · D Collaboration & output · E Platform · F Building with AI |
| Section | the section number (build tasks: the main section they implement) |
| Milestone | built-in field: the repo milestone set on the issue (H0 Harness, then M0 … M7) |

Set a single-select field:
```sh
gh project item-edit --project-id $PROJECT --id $ITEM --field-id $FIELD --single-select-option-id $OPTION
```
Set the Section number: `--number <n>` instead of `--single-select-option-id`. Set a milestone on the issue itself:
`gh issue edit <n> -R picasso-canvas/letzeuspost --milestone "H0 Harness"`.

## Labels

`section` · `build-task` · `needs-zeus` (waiting on Zeus) · `blocked` (something else is missing) · `zeus-only` /
`auto-merge` (the PR's risk tier, set by the CI `risk-gate`; agents never set or remove these; a zeus-only PR is merged
by Zeus himself) · `audit` (weekly audit).

## Sections (label `section`, issues #1–#22: issue number = section number)

| When | Do |
|---|---|
| Interview round starts | Status → Interview |
| Doc drafted | Status → Draft; comment with the doc link and what Zeus needs to decide |
| Zeus approves | Write the final doc to `docs/plan/NN-*.md`, update its row in `00-roadmap.md`, commit + push; Status → Approved; comment "Approved <date>" + the doc link |

## Build tasks (label `build-task`)

Created by Athena only after the sections they need are approved. The first milestone is **H0 Harness**.
- Title: `[<milestone>] <what gets built>`.
- Body: Goal (one line) · Section doc links · Spec excerpt · **Done when** checklist · predicted risk tier (auto /
  zeus-only) · **Areas** (paths it may touch) · Not in this task · Depends on (issue numbers).
- Label `build-task`, repo milestone. Add to the project with Kind = Build task, Section, Status = Not started.
- **Athena** moves tasks of approved sections to Ready to build. Zeus can pull any back.

The building agent:

| When | Do |
|---|---|
| Start | Status → In progress; worktree + branch `<issue>-<slug>`; a 3–5 line approach comment |
| PR opened | PR says `Closes #<n>`; auto-merge on (`gh pr merge --auto --squash`); Status → In review |
| Merged | Status → Done (the issue closes from the PR) |
| Question for Zeus | Comment with the question and options, add label `needs-zeus`, stop |
| Blocked by something else | Add label `blocked`, comment what is missing and who can fix it |

## Weekly audit (Athena, every Friday)

Open an issue titled `Audit <year>-W<week>` with label `audit`, assigned to `picasso-canvas`, covering:
- PRs merged (tier, reviewers, findings) and zeus-only PRs waiting
- visual baseline changes, with before/after images
- the trend in test counts and coverage, and any flaky tests
- guardrail hits (`.claude/logs/guardrail-hits.jsonl`)
- build AI usage and product eval results
- suggested reverts

Zeus comments or ticks items; reverts go in as revert PRs.

Comments are one to three lines: what was done and what comes next. Details live in the docs and the PR.
