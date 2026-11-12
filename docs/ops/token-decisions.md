# Token decisions

`scripts/token-usage.ts` proposes savings; it never applies one. Zeus decides each proposal on the `token-review`
issue (`approve <id>` or `reject <id> <reason>`), and Athena records it here the same day, then applies an approved one
through a normal PR and marks it `applied`.

- **rejected**: not proposed again for 30 days.
- **approved**, **applied**: not proposed again; the change is Athena's to make or has been made.

Prices live in `docs/ops/token-prices.json` (dollars per million tokens, first-party rates). Cache writes are priced at
1.25× input, the 5-minute rate; correct the file if the real rate differs. The numbers are estimates, not the invoice.

| Proposal id | Decision | Date | Note |
|---|---|---|---|

## Per-task line and context health

When Athena ships a builder's branch, `scripts/ship.ts` adds one line to the approach comment on the issue: the task's
tokens, calls, estimated cost and a context-health rating. The rating is the average context per call: green under 60K,
amber from 60K, red from 110K tokens. It is informational and never blocks a merge: a sensitive task can legitimately
run red. The thresholds are `healthAmber` and `healthRed` in `scripts/token-usage.ts`; they came from the 30 builder
tasks of 2026-11-12 (all on Opus, before the compaction window), so recalibrate after about 10 tasks on the new setup.
Change them in a PR after a decision above, not in passing. The line holds numbers only.
