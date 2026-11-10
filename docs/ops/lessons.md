# Lessons

The learning loop's record
([§19](../plan/19-build-team-and-workflow.md#learning-loop-zeus-2026-11-10)): each type of finding
seen on 2 or more PRs, the prevention chosen for it, and its status. `scripts/lessons.ts` counts the
findings; the weekly report lists every type found on 2 or more PRs and what was done about each.
Cheapest prevention first: a machine check, then a refusal in ship or the merge gate, then a
checklist or agent line.

## The first count (2026-11-10)

198 reviews on 37 PRs, 85 of them blocks. Counted by keyword before findings had types, so the
numbers are approximate.

| Type | PRs | Prevention | Status |
|---|---|---|---|
| PR text or Done-when evidence out of date, or missing | 20 | Ship (builders) and the merge gate (Athena's PRs) refuse evidence that doesn't name the head commit | Planned |
| A file changed outside the task's Areas | 13 | Ship refuses a branch that changes a file outside the task's Areas | Planned |
| A finding left unanswered in a fix round | 13 | Numbered findings; ship and the gate refuse a fix round whose Round section misses a number | Planned |
| Tests-first not visible in a batch's history | 9 | `tasks.md` in batch bundles (#134) | Done 2026-11-10 |
| A decision of Zeus's not recorded where the reviewers look | 4 | Athena records each chat decision, dated, on the task's own issue or PR (the one in the reviewers' bundle) in the same turn | In force 2026-11-10 |

One more reason for feature batches, not a repeated finding type: a single should-fix in one task
held batch #130's four other tasks (2026-11-09 and 2026-11-10).
