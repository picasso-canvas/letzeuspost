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
