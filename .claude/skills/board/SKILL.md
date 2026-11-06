---
name: board
description: Update the LetZeusPost GitHub Project board (Athena only). Use when a planning section changes status, when an approved section is broken into build tasks, when a builder starts or opens a PR, when a question needs Zeus, or when writing the weekly report.
---

# LetZeusPost board (GitHub Projects)

- Repo `picasso-canvas/letzeuspost`. Project **LetZeusPost** #2 (owner `picasso-canvas`):
  https://github.com/users/picasso-canvas/projects/2
- **Athena runs this skill with Zeus's own login.** Builder agents use the repo-only token, which can't reach a board
  owned by a personal account, so they don't touch the board; they comment on their issue instead.
- Every ID (project, fields, options, section items, milestones) is in `.claude/board-ids.json`. Read the IDs from
  there and don't look them up again. Section keys are two-digit strings: `.sections["07"]`, not `["7"]`. If an ID fails, rebuild the file with
  `gh project field-list 2 --owner picasso-canvas --format json`.
- Replacing a single-select field's options (GraphQL `updateProjectV2Field`) **wipes that field on every item**:
  re-set the values right after.
- Keep calls small: one `gh` call per change, `--jq` to keep only what you need, never print the whole board.

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

`section` · `build-task` · `needs-zeus` (waiting on Zeus) · `blocked` (something else is missing) · `sensitive` /
`routine` (the PR's tier, set by the CI `risk-gate`; nobody sets them by hand) · `audit` (weekly report).

## Sections (label `section`, issues #1–#23: issue number = section number)

| When | Do |
|---|---|
| Interview round starts | Status → Interview |
| Doc drafted | Status → Draft; comment with the doc link and what Zeus needs to decide |
| Zeus approves | Write the final doc to `docs/plan/NN-*.md`, update its row in `00-roadmap.md`, commit + push; Status → Approved; comment "Approved <date>" + the doc link |

## Build tasks (label `build-task`)

Created by Athena only after the sections they need are approved. The first milestone is **H0 Harness**.
- Title: `[<milestone>] <what gets built>`.
- Body: Goal (one line) · Section doc links · Spec excerpt · **Done when** checklist · predicted tier (`routine` /
  `sensitive`) · **Areas** (paths it may touch) · Not in this task · Depends on (issue numbers).
- Label `build-task`, repo milestone. Add to the project with Kind = Build task, Section, Status = Not started.
- Athena moves tasks of approved sections to Ready to build (Zeus can pull any back).

| When | Athena does |
|---|---|
| A builder starts | Status → In progress |
| The builder opens its PR | Status → In review |
| The builder adds `needs-zeus` or `blocked` | Tell Zeus in chat |
| Zeus merges | The issue closes from the PR; the board's built-in workflow sets Done (otherwise Athena does) |

## Weekly report (Athena, Fridays)

Open an issue titled `Week <year>-W<week>` with label `audit`, assigned to `picasso-canvas`:
- what merged, and which `sensitive` PRs are still waiting
- guardrail hits (`.claude/logs/guardrail-hits.jsonl`)
- AI usage against Zeus's Claude limits
- flaky tests and product eval results

Comments are one to three lines: what was done and what comes next. Details live in the docs and the PR.
