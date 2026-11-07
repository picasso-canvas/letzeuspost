---
name: tdd
description: How LetZeusPost builders write code test-first and prove it's done. Use for every change with logic in it, every bug fix, and before claiming any task is finished.
---

# Test first, then prove it

## The loop

1. **Write one failing test** for the next small behaviour, named for what the user or caller sees
   (`refuses a review link after 30 days`, not `test expiry`).
2. **Run it and watch it fail for the right reason**: the assertion fails, not an import error or a typo. If it passes
   already, the test is wrong or the behaviour exists; find out which before going on.
3. **Commit the failing test** (`test(scope): …`), so the history shows it came first.
4. **Write the smallest code that makes it pass.** No extra features, options or "while I'm here" changes.
5. **Run the test, then `pnpm check`.** Refactor only while everything is green, then run `pnpm check` again.
6. Repeat for the next behaviour. Several small loops beat one big one.

**A bug fix starts with a test that reproduces the bug** and fails before the fix. No regression test, no fix.

## What a good test is

- It checks behaviour through the public interface, with real inputs: English and Bangla text, empty and huge
  values, the edges (0, 1, the limit, one past it), time zones, other workspaces' ids.
- It would fail if the code were wrong. Try it: break the code on purpose and see the test go red.
- It is fast and repeatable: no real network, no sleeps, no dependence on the clock or on other tests (inject time
  and randomness).

## What doesn't count

- Testing a mock instead of the code (asserting the mock was called with what you just passed it).
- A test that can't fail: `expect(true)`, asserting what the test itself set up, or snapshots of whole objects nobody
  reads.
- `.only`, `.skip`, `xit`, commented-out tests, a lowered coverage or threshold, `@ts-ignore`, `eslint-disable`. The
  hooks block them; don't try to get around that.

## Done means proven

You may say a Done-when item is done only when **you ran the command in this session and saw it pass**. Paste the
command and the lines that prove it into `.lzp/pr.md`. "Should work", "probably passes" or a result from earlier in
the session doesn't count: run `pnpm check` fresh on your last commit before you finish.
