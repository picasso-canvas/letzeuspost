# Sources: shadcn

- **Repo:** https://github.com/shadcn-ui/ui
- **Commit:** `8ab27715521cbd4f87ae6886cd989cbb678f6de7` (main, 2026-11-08)
- **Licence:** MIT (`LICENSE.md`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08.
- **Discovery:** the skill lives directly at `.claude/skills/shadcn/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).
- **CLI pinned to:** `shadcn@4.23.0`: the version in `packages/shadcn/package.json` at the pinned commit, tag
  `shadcn@4.23.0` (`96da9cc`, 2026-10-27), published to npm on 2026-10-27.

## Paths copied

From `skills/shadcn/`:

| File | Changed |
|---|---|
| `SKILL.md` | yes |
| `cli.md` | yes |
| `customization.md` | yes |
| `design-system.md` | yes |
| `design-system-page.md` | no |
| `rules/base-vs-radix.md` | yes |
| `rules/composition.md` | no |
| `rules/forms.md` | no |
| `rules/icons.md` | no |
| `rules/styling.md` | no |
| `LICENSE.md` (repo root) | no |

## Left out

- `mcp.md`: sets up the shadcn MCP server (`shadcn mcp init` writes `.mcp.json`). Adding an MCP server needs Zeus's OK.
  `SKILL.md` doesn't link it.
- `registry.md`: authoring and publishing registries, and notes for working on the shadcn codebase itself. We don't
  publish a registry. `SKILL.md` and `cli.md` still link it; the note at the top of `SKILL.md` says it isn't here.
- `rules/chat.md`: chat and AI-conversation components. The plan has no chat UI, and its example injects an inline
  script with `dangerouslySetInnerHTML`, which `lzp/no-dangerous-html` bans. `SKILL.md`, `rules/composition.md` and
  `design-system-page.md` still mention it.
- `assets/showcase/` (`color-pair.tsx`, `state-matrix.tsx`, `preview-states.css`) and `scripts/showcase-coverage.mjs`:
  helpers for a standalone design-system page app. Our component gallery is Storybook in `packages/ui` (§13), and code
  files here would be linted and format-checked with the repo (the `.tsx` files import `@/lib/utils`, which doesn't
  exist, and sit outside every tsconfig). The script only reads files and prints a list.
- `assets/shadcn.png`, `assets/shadcn-small.png`, `agents/openai.yml`: OpenAI Codex UI metadata and its icons.
- `evals/evals.json`: upstream's own evals.

## Changes we made

1. `SKILL.md` front matter: **removed `allowed-tools`**. It pre-approved `Bash(npx shadcn@latest *)`,
   `Bash(pnpm dlx shadcn@latest *)` and `Bash(bunx --bun shadcn@latest *)`; permissions come from our settings.
2. `SKILL.md` "Current Project Context": **removed the bang-backtick block** that ran `npx shadcn@latest info --json`.
   In a skill it runs at load time, and it downloaded the unpinned CLI. Replaced with an instruction to run
   `pnpm dlx shadcn@4.23.0 info --json` in the folder that holds `components.json`. Matching wording: "The JSON above"
   → "The JSON it prints"; "Key Fields": "The injected project context" → "The project context (`info --json`)";
   "Workflow" step 1: "already injected above" → run the command.
3. **Pinned the CLI:** every `npx shadcn@latest` → `pnpm dlx shadcn@4.23.0` (120 occurrences: `SKILL.md` 65, `cli.md`
   40, `customization.md` 10, `design-system.md` 4, `rules/base-vs-radix.md` 1).
4. `SKILL.md` and `cli.md` "IMPORTANT" runner notes (pick `npx`, `pnpm dlx` or `bunx --bun` with `@latest` by
   `packageManager`) → one line: run every command as `pnpm dlx shadcn@4.23.0`, never `@latest`.
5. `SKILL.md`: a LetZeusPost note under the title: the pinned version and the removals; this repo is Next.js App Router
   (`--template next` where a step asks for one), components in `packages/ui`, Base UI, icons from `lucide-react` only,
   Inter only (§13, §21); `DESIGN.md` and §21 win; the files not in this copy.
6. `design-system.md` Step 2: `npx tsc` → `pnpm exec tsc` (twice). Without a local TypeScript, `npx tsc` downloads the
   unrelated `tsc` npm package.
7. `design-system.md` "Fonts": removed the `npm install` of three Fontsource fonts (unpinned; Cormorant Garamond and
   JetBrains Mono are banned by `lzp/inter-only`). A LetZeusPost note says Inter is the only interface font and is
   already pinned in `packages/ui`; the CSS example stays as a pattern.

## Review notes

Every copied file read in full, and the left-out `mcp.md`, `registry.md`, `rules/chat.md`, showcase helpers, script and
`agents/openai.yml` too. Text only once change 2 is made: no hooks, install scripts or telemetry. Upstream's stance worth
knowing:

- The CLI talks to the network when run: `pnpm dlx` fetches `shadcn@4.23.0` on first use, and `add`, `search`, `view`,
  `docs` and `apply` read registries (ui.shadcn.com by default; community registries and `owner/repo` GitHub
  addresses when named). `SKILL.md` says to fetch the URLs `docs` prints.
- Several steps "ask the user" (which registry, how to switch presets, before `--overwrite`). For a headless builder
  that means `needs-zeus` in `.lzp/pr.md` (the agent file and `CLAUDE.md` win).
- `design-system.md` scaffolds a new app with `init --name`; this repo already exists.
- `rules/icons.md` and "Key Fields" say "never assume `lucide-react`"; here it is the only icon set (note at the top).

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. Its URL list
flags `ui.shadcn.com` (schema and docs links) and `api.npoint.io` (an example in `cli.md`); the text fetches none.
On the unchanged upstream folder it reported 3 high findings: the load-time `npx shadcn@latest info --json` (removed,
change 2) and XMP metadata in the two logo PNGs (an orientation tag only; left out).
