# Sources: systematic-debugging

- **Repo:** https://github.com/obra/superpowers
- **Commit:** `22f0b463e7a5e579904dd6211a520321035526f7` (main, 2026-11-03)
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-07 by Athena (task #31). Copied the skill folder only, never the superpowers plugin (its
  startup hook injects instructions).
- **Discovery:** Claude Code finds skills only at `.claude/skills/<name>/SKILL.md`, so
  `.claude/skills/systematic-debugging` is a relative symlink to this folder.

## Paths copied

From `skills/systematic-debugging/`:

| File | Changed |
|---|---|
| `SKILL.md` | yes |
| `root-cause-tracing.md` | yes |
| `defense-in-depth.md` | no |
| `condition-based-waiting.md` | yes |
| `find-polluter.sh` | yes (mode 755, as upstream) |

## Left out

- `condition-based-waiting-example.ts`: an example from another project (imports `~/threads/...` that don't exist
  here). ESLint lints every `.ts` file in the repo with type information, so it would break `pnpm check`.
- `tests/systematic-debugging/**` (pressure scenarios, `test-find-polluter.sh`): upstream's own tests.

## Changes we made

1. `SKILL.md` Phase 4 step 1: `superpowers:test-driven-development` → our `tdd` skill.
2. `SKILL.md` Phase 4 step 3: `superpowers:verification-before-completion` → "the `tdd` skill's proof rules (fresh
   `pnpm check` output)". Those superpowers skills aren't installed here.
3. `condition-based-waiting.md`: the pointer to `condition-based-waiting-example.ts` now says the file isn't in this
   copy.
4. `root-cause-tracing.md` and `find-polluter.sh`: `npm test` → `pnpm vitest run` (our test runner).

## Review notes

Every file read in full before vendoring. No hooks, no install steps, no network calls, no telemetry, no hidden
text. `find-polluter.sh` only runs `find`, the test runner and `ls` inside the current folder. The Phase 1 example in
`SKILL.md` runs `security list-keychains` / `security find-identity` to debug macOS code signing; it's left as
upstream wrote it, but builders are sandboxed away from the Keychain and must not run it.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-07.
