# Lessons

The learning loop's record
([§19](../plan/19-build-team-and-workflow.md#learning-loop-zeus-2026-11-10)): each type of finding
seen on 2 or more PRs, the prevention chosen for it, and its status. `scripts/lessons.ts` counts the
findings; the weekly report lists every type found on 2 or more PRs and what was done about each.
Cheapest prevention first: a machine check, then a refusal in ship or the merge gate, then a
checklist or agent line.

## The first count (2026-11-10)

198 reviews on 37 PRs, 85 of them blocks. These findings were written before they had types, so
`scripts/lessons.ts` types them by keyword and marks them approximate; most of them (759) fit no
keyword and count as `other`. The PRs column counts finding lines. The first count (§19, #136)
matched whole reviews, including their "checked and fine" lines, and gave higher numbers: 20, 13,
13, 9 and 4. From #137 on, reviewers type each finding, so the counts are exact.

| Type | Slug | PRs | Prevention | Status |
|---|---|---|---|---|
| PR text or Done-when evidence out of date, or missing | `evidence` | 11 | Ship (builders) and the merge gate (Athena's PRs) refuse evidence that doesn't name the head commit (#138) | Done 2026-11-10 (#138) |
| A file changed outside the task's Areas | `areas` | 12 | Ship refuses a branch that changes a file outside the task's Areas (#138) | Done 2026-11-10 (#138) |
| A finding left unanswered in a fix round | `unanswered` | 7 | Numbered findings (#137); ship and the gate refuse a fix round whose Round section misses a number (#138) | Done 2026-11-10 (#138) |
| Tests-first not visible in a batch's history | `tests-first` | 4 | `tasks.md` in batch bundles (#134) | Done 2026-11-10 |
| A decision of Zeus's not recorded where the reviewers look | `decision-record` | 3 | Athena records each chat decision, dated, on the task's own issue or PR (the one in the reviewers' bundle) in the same turn | In force 2026-11-10 |

## The count again (2026-11-19)

`node scripts/lessons.ts` run on `main` at `cb5b5c2`, with the parser of #273 (a finding counts in any markup and
spelling of its tag, so bulleted, bold and `[should fix]` findings that the first parser dropped are in it). The
counts come from the review records in `~/.letzeuspost/reviews/`, not from git, so the commit names the code the run
used, not a snapshot of the records. A type is exact when reviewers typed it; "approximate" ones come from
before types existed. The first count's PRs column above stays as it was.

| Type | PRs | Findings | Blocking |
|---|---|---|---|
| `evidence` (approximate) | 56 | 129 | 21 |
| `other` (approximate) | 41 | 791 | 110 |
| `correctness` | 41 | 128 | 12 |
| `unknown` | 32 | 120 | 11 |
| `simplicity` | 23 | 35 | 0 |
| `guardrails` | 22 | 56 | 8 |
| `tests-first` (approximate) | 21 | 38 | 4 |
| `decision-record` (approximate) | 16 | 31 | 13 |
| `plan` | 16 | 25 | 2 |
| `areas` (approximate) | 15 | 16 | 5 |
| `unanswered` (approximate) | 12 | 20 | 4 |
| `design` | 10 | 35 | 8 |
| `copy` | 10 | 16 | 0 |
| `security` | 8 | 13 | 2 |
| `states` | 7 | 16 | 9 |
| `isolation` | 6 | 13 | 1 |
| `auth` | 6 | 12 | 1 |
| `a11y` | 3 | 8 | 5 |
| `uploads` | 1 | 2 | 0 |
| `billing` | 1 | 1 | 0 |
| `secrets` | 1 | 1 | 0 |
| `dependencies` | 1 | 1 | 0 |

One more reason for feature batches, not a repeated finding type: a single should-fix in one task
held batch #130's four other tasks (2026-11-09 and 2026-11-10).

## Incidents

Things that went wrong once and are worth a rule, though no reviewer finding type counts them.

| Date | What happened | Prevention | Status |
|---|---|---|---|
| 2026-11-10 | #166 moved each builder's git config outside its clone, so the builder couldn't rewrite it. Unit tests passed, but the builder sandbox reads only the clone, so every git command failed. The #72, #73 and #69 builders all stopped before writing code. | A change to what a builder's session reads, writes or runs is checked in a real sandboxed builder session (dispatch's flags and environment, in a throwaway clone) before it merges, and that check is the PR's red-team evidence (#174) | In force 2026-11-10 |
