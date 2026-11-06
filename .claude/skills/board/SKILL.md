---
name: board
description: Update the LetZeusPost GitHub Project board. Use when a planning section changes status, when an approved section is broken into build tasks, when starting, finishing or getting stuck on a build task, or when a question needs Zeus.
---

# LetZeusPost board (GitHub Projects)

- Repo `picasso-canvas/letzeuspost`. Project **LetZeusPost** #2 (owner `picasso-canvas`):
  https://github.com/users/picasso-canvas/projects/2
- Every ID (project, fields, options, section items, milestones) is in `.claude/board-ids.json`. Read the IDs from
  there and don't look them up again. If an ID fails, rebuild the file with
  `gh project field-list 2 --owner picasso-canvas --format json`.
- Keep calls small: one `gh` call per change, `--jq` to keep only what you need, never print the whole board.

## Fields

| Field | Values |
|---|---|
| Status | Not started · Interview · Draft · Approved (sections) · Ready to build · In progress · In review · Done (build tasks) |
| Kind | Section · Build task |
| Part | A Product & business · B Experience · C Engine · D Collaboration & output · E Platform |
| Section | the section number (build tasks: the main section they implement) |
| Milestone | built-in field: the repo milestone (M0 … M7) set on the issue |

Set a single-select field:
```sh
gh project item-edit --project-id $PROJECT --id $ITEM --field-id $FIELD --single-select-option-id $OPTION
```
Set the Section number: `--number <n>` instead of `--single-select-option-id`. Set a milestone on the issue itself:
`gh issue edit <n> -R picasso-canvas/letzeuspost --milestone M3`.

## Sections (label `section`, issues #1–#18: issue number = section number)

| When | Do |
|---|---|
| Interview round starts | Status → Interview |
| Doc drafted | Status → Draft; comment with the doc link and what Zeus needs to decide |
| Zeus approves | Write the final doc to `docs/plan/NN-*.md`, update its row in `00-roadmap.md`, commit + push; Status → Approved; comment "Approved <date>" + the doc link |

## Build tasks (label `build-task`)

Created by Athena only after the sections they need are approved.
- Title: `[M<n>] <what gets built>`.
- Body: Goal (one line) · Section doc links · Spec excerpt · **Done when** checklist · Not in this task · Depends on (issue numbers).
- Label `build-task`, repo milestone M0–M7. Add to the project with Kind = Build task, Section, Status = Not started.
  **Zeus** moves it to Ready to build.

The building agent:
| When | Do |
|---|---|
| Start | Status → In progress; branch `<issue>-<slug>` |
| PR opened | PR says `Closes #<n>`; Status → In review |
| Merged | Status → Done (the issue closes from the PR) |
| Question for Zeus | Comment with the question and options, add label `needs-zeus`, stop |
| Blocked by something else | Add label `blocked`, comment what is missing and who can fix it |

Comments are one to three lines: what was done and what comes next. Details live in the docs and the PR.
