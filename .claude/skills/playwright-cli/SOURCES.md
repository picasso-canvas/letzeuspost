# Sources: playwright-cli

- **Repo:** https://github.com/microsoft/playwright-cli
- **Commit:** `4bc00fb7fa5b4329f2fb53ac4743a066c2c664e8` (main, 2026-11-05)
- **Licence:** Apache-2.0 (`LICENSE`, copied from the repo root, beside this file). Changed files say so at the top,
  as Apache-2.0 §4(b) asks.
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08. Used pinned (§21).
- **Discovery:** the skill lives directly at `.claude/skills/playwright-cli/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).
- **Pinned:** the CLI runs as `pnpm exec playwright cli` from the repo's own Playwright (`@playwright/test` pinned in
  `package.json`, 1.65.0 today; its `playwright-core` includes the `cli` command). No standalone copy (change 10).
  The latest standalone release is `@playwright/cli@0.1.23` (marked in `0a80807`, 2026-10-31); the pinned commit's
  skill differs from the `0a80807` one by one sentence ("Event listener errors are reported as console errors." in
  `references/running-code.md`).

## Paths copied

From `skills/playwright-cli/`:

| File | Changed by us |
|---|---|
| `SKILL.md` | yes (marked at the top) |
| `references/element-attributes.md` | no |
| `references/playwright-tests.md` | yes (marked at the top) |
| `references/request-mocking.md` | no |
| `references/running-code.md` | no |
| `references/session-management.md` | yes (marked at the top) |
| `references/storage-state.md` | no |
| `references/test-generation.md` | yes (marked at the top) |
| `references/tracing.md` | no |
| `references/video-recording.md` | yes (marked at the top) |
| `LICENSE` (repo root) | no |

## Left out

- `references/pr-attachments.md`: attaching screenshots and videos with `gh pr create/comment --attach`, and a GitHub
  Actions step that comments on PRs with `GH_TOKEN`. Builders have no GitHub access and never run `gh`.
- The rest of the repo: the CLI's own code (`playwright-cli.js`, `skillCheck.js`, `scripts/update.js`), its tests and
  workflows, and its own `.claude/skills/` (`dev`, `playwright-triage`: release and triage skills for that repo).

## Changes we made

1. `SKILL.md` front matter: **removed `allowed-tools`**. It pre-approved `Bash(playwright-cli:*)`,
   `Bash(npx playwright:*)` and `Bash(npx --no-install playwright:*)`; permissions come from our settings, and
   `npx playwright` can fetch an unpinned package.
2. `SKILL.md`: a LetZeusPost note under the title (Apache-2.0 §4(b) notice): run `pnpm exec playwright cli` wherever the
   skill writes `playwright-cli`; no `gh`; no `show --annotate` in headless runs (it waits for a person); never
   `attach` to a browser you didn't `open` (a running Chrome or Edge holds a person's logins), attaching to your own
   `--debug=cli` run is fine.
3. `SKILL.md` "Installation": `npx --no-install playwright --version`, "use `npx playwright cli`" and
   `npm install -g @playwright/cli@latest` → `pnpm exec playwright --version`, `pnpm exec playwright cli …`, never a
   global or `@latest` install (the `pnpm dlx` fallback this change first added is gone: change 10).
4. `SKILL.md` "Example: Interactive session": a LetZeusPost line: not in headless runs (builders, Iris).
5. `SKILL.md` "Attaching screenshots and videos to pull requests": the `gh pr comment --attach` example and the link to
   `references/pr-attachments.md` → save the screenshot and list it in `.lzp/pr.md`; Athena opens the PR. Removed the
   `pr-attachments.md` line from "Specific tasks".
6. `references/playwright-tests.md`: `npx playwright` → `pnpm exec playwright` (3), plus the notice at the top.
7. `references/test-generation.md`, plus the notice at the top:
   - `npx playwright` → `pnpm exec playwright` (6) and `npx --no-install playwright` → `pnpm exec playwright` (1);
   - 1.1: "If there is no Playwright install, bootstrap one" with `npm init playwright@latest` → this repo already has
     Playwright; never bootstrap another; stop and say so if the checks fail;
   - 3.4: "stop and ask the user" → also "write it in `.lzp/pr.md` under `needs-zeus` and stop";
   - 3.5: "mark the test `test.fixme(...)`" once the user confirms a bug → fix the app or write it under `needs-zeus`;
     never `test.fixme`, `.skip` or `.only` (the research verdict on Playwright's healer: remove the fixme fallback).
8. `references/video-recording.md` section 3: the `gh pr create/comment` and `gh issue comment --attach` commands and
   the `pr-attachments.md` link → list the recording in `.lzp/pr.md`; kept the size advice. Plus the notice at the top.
9. `SKILL.md` LetZeusPost note: "Only throwaway browser state": no `--profile` outside the clone, no real Chrome or
   Edge profile, and saved state, traces and snapshots stay uncommitted (`.playwright-cli/` and `*.auth.json` are in
   the repo's `.gitignore`). Cerberus on #100.
10. `SKILL.md` "Installation": removed "run it pinned: `pnpm dlx @playwright/cli@0.1.23`" for a standalone copy.
    `pnpm dlx` pins only the top package; its dependencies resolve outside the lockfile, the licence check and the
    audits. A standalone copy is now a `needs-zeus` item. Cerberus on #100.
11. `SKILL.md` "Only throwaway browser state": `--persistent` only together with a `--profile` folder inside the
    clone (on its own it picks a folder itself, which may be outside the clone). `references/session-management.md`: a notice at the top that
    the `SKILL.md` rules win over its examples (`--persistent`, `--profile=/path/to/profile`, `--browser=chrome`/
    `msedge`, `attach --cdp=…`, `attach --extension`); the examples are unchanged. Cerberus on #100, round 3.

## Review notes

Every copied file read in full, and `pr-attachments.md` too. Text only: no hooks, install scripts or telemetry. Things
worth knowing:

- The CLI drives a real browser and writes snapshots, traces and videos under `.playwright-cli/` in the working folder.
  That folder isn't in the repo's `.gitignore`.
- `run-code` runs arbitrary Playwright code in the page's context; `state-save` writes cookies and tokens to a file
  (`storage-state.md` says never to commit them).
- WebMCP: pages can offer tools to agents; upstream already says to treat their names, schemas and results as
  untrusted input.
- `session-management.md` still documents `attach --cdp=chrome` and `attach --extension`; the note at the top of
  `SKILL.md` forbids them.
- Playwright 1.65's own `playwright-core` ships a copy of this skill (`lib/tools/skills/playwright-cli`); this vendored
  copy is the one our agents read.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. Its URL list
flags about 60 example URLs (`example.com` and its subdomains, `site1.com`–`site3.com`, `app.com`, `slow-site.com`,
`localhost`, `demo.playwright.dev`, `playwright.dev`) and apache.org in `LICENSE`; the text fetches none.
