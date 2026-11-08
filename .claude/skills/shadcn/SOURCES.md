# Sources: shadcn

- **Repo:** https://github.com/shadcn-ui/ui
- **Commit:** `8ab27715521cbd4f87ae6886cd989cbb678f6de7` (main, 2026-11-08)
- **Licence:** MIT (`LICENSE.md`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08.
- **Discovery:** the skill lives directly at `.claude/skills/shadcn/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).
- **CLI:** the text matches `shadcn@4.23.0`: the version in `packages/shadcn/package.json` at the pinned commit, tag
  `shadcn@4.23.0` (`96da9cc`, 2026-10-27), published to npm on 2026-10-27. It is a pinned dev dependency of
  `packages/ui` (#107) and runs as `pnpm exec shadcn`, by Athena only (change 15).

## Paths copied

From `skills/shadcn/`:

| File | Changed by us |
|---|---|
| `SKILL.md` | yes |
| `cli.md` | yes |
| `customization.md` | yes |
| `design-system.md` | yes |
| `design-system-page.md` | yes |
| `rules/base-vs-radix.md` | yes |
| `rules/composition.md` | yes |
| `rules/forms.md` | no |
| `rules/icons.md` | yes |
| `rules/styling.md` | no |
| `LICENSE.md` (repo root) | no |

## Left out

- `mcp.md`: sets up the shadcn MCP server (`shadcn mcp init` writes `.mcp.json`). Adding an MCP server needs Zeus's OK.
  `SKILL.md` doesn't link it.
- `registry.md`: authoring and publishing registries, and notes for working on the shadcn codebase itself. We don't
  publish a registry, and components come only from `@shadcn` (change 9). Its links and the `build` command are
  removed (change 12).
- `rules/chat.md`: chat and AI-conversation components. The plan has no chat UI, and its example injects an inline
  script with `dangerouslySetInnerHTML`, which `lzp/no-dangerous-html` bans. The links to it are removed (change 12);
  `rules/composition.md` and `design-system-page.md` still name the chat components in their tables.
- `assets/showcase/` (`color-pair.tsx`, `state-matrix.tsx`, `preview-states.css`) and `scripts/showcase-coverage.mjs`:
  helpers for a standalone design-system page app. Our component gallery is Storybook in `packages/ui` (§13), and code
  files here would be linted and format-checked with the repo (the `.tsx` files import `@/lib/utils`, which doesn't
  exist, and sit outside every tsconfig). The script only reads files and prints a list. The steps that copy or run
  them say they aren't here (change 12).
- `assets/shadcn.png`, `assets/shadcn-small.png`, `agents/openai.yml`: OpenAI Codex UI metadata and its icons.
- `evals/evals.json`: upstream's own evals.

## Changes we made

1. `SKILL.md` front matter: **removed `allowed-tools`**. It pre-approved `Bash(npx shadcn@latest *)`,
   `Bash(pnpm dlx shadcn@latest *)` and `Bash(bunx --bun shadcn@latest *)`; permissions come from our settings.
2. `SKILL.md` "Current Project Context": **removed the bang-backtick block** that ran `npx shadcn@latest info --json`.
   In a skill it runs at load time, and it downloaded the unpinned CLI. Replaced with an instruction to run
   `pnpm exec shadcn info --json` in the folder that holds `components.json`. Matching wording: "The JSON above"
   → "The JSON it prints"; "Key Fields": "The injected project context" → "The project context (`info --json`)";
   "Workflow" step 1: "already injected above" → run the command.
3. **The CLI runner:** every remaining `npx shadcn@latest` → `pnpm exec shadcn` (`SKILL.md` 47, `cli.md` 35,
   `customization.md` 10, `design-system.md` 2, `rules/base-vs-radix.md` 1). The first copy used
   `pnpm dlx shadcn@4.23.0`; change 8 replaced it.
4. `SKILL.md` and `cli.md` "IMPORTANT" runner notes (pick `npx`, `pnpm dlx` or `bunx --bun` with `@latest` by
   `packageManager`) → one line: run every command as `pnpm exec shadcn`, never `pnpm dlx`, `npx` or `@latest`.
5. `SKILL.md`: a LetZeusPost note under the title, as a list: the CLI (change 8), the official registry only
   (change 9), this repo (Next.js App Router, `--template next` where a step asks for one, components in
   `packages/ui`, Base UI, icons from `lucide-react` only, Inter only, no new app; §13, §21), `DESIGN.md` and §21 win,
   and the files not in this copy.
6. `design-system.md` Step 2: `npx tsc` → `pnpm exec tsc`. Without a local TypeScript, `npx tsc` downloads the
   unrelated `tsc` npm package. (Upstream's second, Vite-only line is gone: change 11.)
7. `design-system.md` "Fonts": removed the `npm install` of three Fontsource fonts (unpinned; Cormorant Garamond and
   JetBrains Mono are banned by `lzp/inter-only`). A LetZeusPost note says Inter is the only interface font and is
   already pinned in `packages/ui`; the CSS example stays as a pattern.

Round 2, from Cerberus on #100:

8. **No `pnpm dlx`.** It pins only the top package; the CLI's dependencies resolve outside the lockfile, the licence
   check and the audits. The CLI runs as `pnpm exec shadcn`. It isn't a dependency yet, and the builder sandbox can't
   reach `ui.shadcn.com`, which `add`, `search`, `view` and `apply` read; both are harness changes for Zeus. Until
   then a task that needs the CLI writes that under `needs-zeus` and stops (`SKILL.md` note, `cli.md` "IMPORTANT").
9. **The official `@shadcn` registry only.** `SKILL.md`: "Check community registries too" → `search @shadcn` only;
   Workflow step 6 ("Fix imports in third-party components", `@bundui`, `@magicui`) removed; step 8 ("Registry must be
   explicit", `@tailark`, `owner/repo`) → official registry only, anything else is `needs-zeus`; Quick Reference: the
   `@magicui/…`, `owner/repo/item`, `@acme/…` and `@tailark` examples, `add --all` and the search of every configured
   registry removed. `cli.md` `add`: component names from `@shadcn` only (no namespaces, GitHub addresses, URLs or
   local paths); the URL and `owner/repo` `--dry-run` examples and the "audit third-party registry code" line removed;
   `--all` marked "don't use"; `search` is `@shadcn` only; `view`'s `owner/repo/item` example removed; the
   `registries` field says none.
10. **Don't fetch the `docs` URLs.** `SKILL.md` "Component Docs" and Workflow step 4, and `cli.md` `docs`: "fetch
    these URLs" → don't (builders can't reach those hosts); read the component's source in `packages/ui` and the rule
    files instead.
11. **Lucide only, no new app.** `SKILL.md` "Key Fields" `iconLibrary` and `rules/icons.md`: "Never assume
    `lucide-react`" and the `@tabler/icons-react` examples → `lucide-react` only; Workflow's "Review added components"
    step swaps any other icon import for Lucide. Removed the scaffolding: Quick Reference's "Create a new project", "Create a design system app"
    and "Create a monorepo project" examples (`init --name`, `--template vite`, `--no-monorepo`, `add --all -y`);
    `design-system.md` Steps 1 and 2 (`init … --template vite --name`, `add --all -y`, the Vite `tsc` line), with a
    LetZeusPost note that this repo exists and only the needed components are added; `vite` dropped from the template
    lists in `SKILL.md`, `cli.md` and `design-system.md`.
12. **Links to files not in this copy.** `SKILL.md`: the "Chat & Messaging" rules and the `rules/chat.md` and
    `registry.md` references; the `showcase-coverage.mjs` step. `cli.md`: the `build` command (it builds a registry;
    see `registry.md`). `rules/composition.md` and `design-system-page.md`: the `chat.md` links. `design-system.md`:
    the "Coverage check" section; `design-system-page.md`: "run the coverage script". The steps that copy
    `assets/showcase/` now say it isn't here and that the gallery writes what it needs in `packages/ui`.

Round 3, from Argus and Cerberus on #100:

13. **Presets change the design.** `SKILL.md` note: never a preset URL; `apply`, `init --preset`, `init --defaults`,
    `init --force` and switching presets each need Zeus's OK (`needs-zeus`); plain `init` only when the task says to set
    up `components.json`. Marked at "Switching presets" and in Quick Reference ("Initialize existing project": don't
    use; "Apply a preset": needs Zeus's OK). `customization.md` "Changing the Theme": the same note, and the custom
    theme URL example removed. `cli.md`: `--preset` and `--force` marked in the `init` table, a note under `apply`,
    "URL" presets marked "never", and a note under "Presets". `design-system.md`: the Preset input and "Picking a style"
    say a preset or style change needs Zeus's OK.
14. **Nobody to ask.** `SKILL.md` note: where a step says to ask the user, confirm first or get approval (which
    registry, switching presets, `--overwrite`), a builder writes it under `needs-zeus`; "Updating Components" step 4
    says `--overwrite` means `needs-zeus`.

#107 (Zeus, 2026-11-08: Athena adds shadcn components; builders don't run the CLI):

15. `SKILL.md` note and `cli.md` "IMPORTANT": change 8's "isn't a dependency yet … `needs-zeus`" → the CLI is the
    pinned dev dependency in `packages/ui`; Athena runs it and adds components adapted to the token lint; a builder
    whose task needs a component that isn't in `packages/ui/src/components/` writes `needs-zeus`. The note names this
    repo's `components.json` (`base-vega`, `rsc: true`, `lucide`, the `@lzp/ui/…` aliases); says to point the
    registry's `cn` imports at `@lzp/ui/lib/utils` instead of adding the `cn` package; says to run the CLI only in a
    scratch clone with no `.env` and no credentials, with an empty `HOME` and no tokens (it loads `.env` files, and its
    deepmerge advisory is accepted for this use only); and says every npm package `add` installs is a new dependency.
    Argus and Cerberus on #108.

## Review notes

Every copied file read in full, and the left-out `mcp.md`, `registry.md`, `rules/chat.md`, showcase helpers, script and
`agents/openai.yml` too. Text only once change 2 is made: no hooks, install scripts or telemetry. Upstream's stance worth
knowing:

- The CLI talks to the network when run: `add`, `search`, `view`, `docs` and `apply` read registries (ui.shadcn.com by
  default; upstream also uses community registries, `owner/repo` GitHub addresses and URLs, which this copy forbids:
  change 9). The builder sandbox reaches none of these hosts today.
- Several steps "ask the user" (which registry, how to switch presets, before `--overwrite`). For a headless builder
  that means `needs-zeus` in `.lzp/pr.md` (the agent file and `CLAUDE.md` win).
- Upstream's `design-system.md` scaffolds a new app with `init --name`; this repo already exists (change 11).

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. Its URL list
flags `ui.shadcn.com` (schema and docs links) and `api.npoint.io` (an example in `cli.md`, removed in change 9); the
text fetches none. On the unchanged upstream folder it reported 3 high findings: the load-time
`npx shadcn@latest info --json` (removed, change 2) and XMP metadata in the two logo PNGs (an orientation tag only;
left out).
