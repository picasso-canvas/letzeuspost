---
name: board
description: Update the LetZeusPost GitHub Project board. Use when a planning section changes status, when an approved section is broken into build tasks, when starting, finishing or getting stuck on a build task, or when a question needs Zeus.
---

# LetZeusPost board (GitHub Projects)

- Repo `picasso-canvas/letzeuspost`. Project **LetZeusPost** (owner `picasso-canvas`).
- Every ID (project, fields, options, section items) is in `.claude/board-ids.json`. Read the IDs from there and
  don't look them up again. If an ID fails, rebuild the file with `gh project field-list <number> --owner picasso-canvas --format json`.
- Keep calls small: one `gh` call per change, `--jq` to keep only what you need, never print the whole board.

## Fields

| Field | Values |
|---|---|
| Status | Not started · Interview · Draft · Approved (sections) · Ready to build · In progress · In review · Done (build tasks) |
| Type | Section · Build task |
| Part | A Product & business · B Experience · C Engine · D Collaboration & output · E Platform |
| Section | the section number (build tasks: the main section they implement) |
| Milestone | M0 … M7 (build tasks) |

Set a single-select field:
```sh
gh project item-edit --project-id $PROJECT --id $ITEM --field-id $FIELD --single-select-option-id $OPTION
```
Set the Section number: `--number <n>` instead of `--single-select-option-id`.

## Sections (label `section`, issues §01–§18)

| When | Do |
|---|---|
| Interview round starts | Status → Interview |
| Doc drafted | Status → Draft; comment with the doc link and what Zeus needs to decide |
| Zeus approves | Write the final doc to `docs/plan/NN-*.md`, update its row in `00-roadmap.md`, commit + push; Status → Approved; comment "Approved <date>" + the doc link |

## Build tasks (label `build-task`)

Created by Athena only after the sections they need are approved.
- Title: `[M<n>] <what gets built>`.
- Body: Goal (one line) · Section doc links · Spec excerpt · **Done when** checklist · Not in this task · Depends on (issue numbers).
- Add to the project with Type = Build task, Section, Milestone, Status = Not started. **Zeus** moves it to Ready to build.

The building agent:
| When | Do |
|---|---|
| Start | Status → In progress; branch `<issue>-<slug>` |
| PR opened | PR says `Closes #<n>`; Status → In review |
| Merged | Status → Done (the issue closes from the PR) |
| Question for Zeus | Comment with the question and options, add label `needs-zeus`, stop |
| Blocked by something else | Add label `blocked`, comment what is missing and who can fix it |

Comments are one to three lines: what was done and what comes next. Details live in the docs and the PR.
