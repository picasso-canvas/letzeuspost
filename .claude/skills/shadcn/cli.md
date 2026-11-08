# shadcn CLI Reference

Configuration is read from `components.json`.

> **IMPORTANT:** Always run commands as `pnpm exec shadcn` (LetZeusPost: the pinned dev dependency in `packages/ui`, never `pnpm dlx`, `npx` or `@latest`. Athena runs it; builders don't, and a task that needs a new shadcn component writes that under `needs-zeus` in `.lzp/pr.md` and stops). Examples below use it.
>
> **LetZeusPost:** components come only from the official `@shadcn` registry; see the note at the top of `SKILL.md`.

> **IMPORTANT:** Only use the flags documented below. Do not invent or guess flags — if a flag isn't listed here, it doesn't exist. The CLI auto-detects the package manager from the project's lockfile; there is no `--package-manager` flag.

## Contents

- Commands: init, apply, add (dry-run, smart merge), search, view, docs, info
- Templates: next, start, react-router, astro
- Presets: named, code, URL formats and fields
- Switching presets

---

## Commands

### `init` — Initialize or create a project

```bash
pnpm exec shadcn init [components...] [options]
```

Initializes shadcn/ui in an existing project or creates a new project (when `--name` is provided). Optionally installs components in the same step.

| Flag                    | Short | Description                                               | Default |
| ----------------------- | ----- | --------------------------------------------------------- | ------- |
| `--template <template>` | `-t`  | Template (next, start, next-monorepo, react-router)       | —       |
| `--preset [name]`       | `-p`  | Preset configuration (named, code, or URL; LetZeusPost: needs Zeus's OK, never a URL) | — |
| `--yes`                 | `-y`  | Skip confirmation prompt                                  | `true`  |
| `--defaults`            | `-d`  | Use defaults (`--template=next --preset=base-nova`)       | `false` |
| `--force`               | `-f`  | Force overwrite existing configuration (LetZeusPost: needs Zeus's OK) | `false` |
| `--cwd <cwd>`           | `-c`  | Working directory                                         | current |
| `--name <name>`         | `-n`  | Name for new project                                      | —       |
| `--silent`              | `-s`  | Mute output                                               | `false` |
| `--rtl`                 |       | Enable RTL support                                        | —       |
| `--reinstall`           |       | Re-install existing UI components                         | `false` |
| `--monorepo`            |       | Scaffold a monorepo project                               | —       |
| `--no-monorepo`         |       | Skip the monorepo prompt                                  | —       |

`pnpm exec shadcn create` is an alias for `pnpm exec shadcn init`.

### `apply` — Apply a preset to an existing project

```bash
pnpm exec shadcn apply [preset] [options]
```

Applies a preset to an existing project, overwriting preset-driven config, fonts, CSS variables, and detected UI components.

LetZeusPost: that rewrites the design from `DESIGN.md`, so `apply` needs Zeus's OK (`needs-zeus`); never a preset URL.

| Flag                | Short | Description                                | Default |
| ------------------- | ----- | ------------------------------------------ | ------- |
| `--preset <preset>` | —     | Preset configuration (named, code, or URL) | —       |
| `--yes`             | `-y`  | Skip confirmation prompt                   | `false` |
| `--cwd <cwd>`       | `-c`  | Working directory                          | current |
| `--silent`          | `-s`  | Mute output                                | `false` |

`[preset]` is a shorthand for `--preset <preset>`. If both are provided, they must match.
If no preset is provided, the CLI offers to open the custom preset builder on `ui.shadcn.com/create`.

### `add` — Add components

> **IMPORTANT:** To compare local components against upstream or to preview changes, ALWAYS use `pnpm exec shadcn add <component> --dry-run`, `--diff`, or `--view`. NEVER fetch raw files from GitHub or other sources manually. The CLI handles registry resolution, file paths, and CSS diffing automatically.

```bash
pnpm exec shadcn add [components...] [options]
```

Accepts component names (`button`, `@shadcn/button`). LetZeusPost: from the official
`@shadcn` registry only; no other namespaces, GitHub addresses, URLs or local paths.

| Flag            | Short | Description                                                                                                          | Default |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| `--yes`         | `-y`  | Skip confirmation prompt                                                                                             | `false` |
| `--overwrite`   | `-o`  | Overwrite existing files                                                                                             | `false` |
| `--cwd <cwd>`   | `-c`  | Working directory                                                                                                    | current |
| `--all`         | `-a`  | Add all available components (LetZeusPost: don't use; add only the components a task needs)                         | `false` |
| `--path <path>` | `-p`  | Target path for the component                                                                                        | —       |
| `--silent`      | `-s`  | Mute output                                                                                                          | `false` |
| `--dry-run`     |       | Preview all changes without writing files                                                                            | `false` |
| `--diff [path]` |       | Show diffs. Without a path, shows the first 5 files. With a path, shows that file only (implies `--dry-run`)         | —       |
| `--view [path]` |       | Show file contents. Without a path, shows the first 5 files. With a path, shows that file only (implies `--dry-run`) | —       |

#### Dry-Run Mode

Use `--dry-run` to preview what `add` would do without writing any files. `--diff` and `--view` both imply `--dry-run`.

```bash
# Preview all changes.
pnpm exec shadcn add button --dry-run

# Show diffs for all files (top 5).
pnpm exec shadcn add button --diff

# Show the diff for a specific file.
pnpm exec shadcn add button --diff button.tsx

# Show contents for all files (top 5).
pnpm exec shadcn add button --view

# Show the full content of a specific file.
pnpm exec shadcn add button --view button.tsx

# CSS diffs.
pnpm exec shadcn add button --diff globals.css
```

**When to use dry-run:**

- When the user asks "what files will this add?" or "what will this change?" — use `--dry-run`.
- Before overwriting existing components — use `--diff` to preview the changes first.
- When the user wants to inspect component source code without installing — use `--view`.
- When checking what CSS changes would be made to `globals.css` — use `--diff globals.css`.

> **`pnpm exec shadcn add --dry-run` vs `pnpm exec shadcn view`:** Prefer `pnpm exec shadcn add --dry-run/--diff/--view` over `pnpm exec shadcn view` when the user wants to preview changes to their project. `pnpm exec shadcn view` only shows raw registry metadata. `pnpm exec shadcn add --dry-run` shows exactly what would happen in the user's project: resolved file paths, diffs against existing files, and CSS updates. Use `pnpm exec shadcn view` only when the user wants to browse registry info without a project context.

#### Smart Merge from Upstream

See [Updating Components in SKILL.md](./SKILL.md#updating-components) for the full workflow.

### `search` — Search the registry

```bash
pnpm exec shadcn search @shadcn [options]
```

Fuzzy search. Also aliased as `pnpm exec shadcn list`.
LetZeusPost: search the official `@shadcn` registry only. Without `-q`, lists all items.

| Flag                | Short | Description                                       | Default |
| ------------------- | ----- | ------------------------------------------------- | ------- |
| `--query <query>`   | `-q`  | Search query                                      | —       |
| `--type <type>`     | `-t`  | Filter by item type (e.g. `ui`, `block`, `hook`); comma-separated | —       |
| `--limit <number>`  | `-l`  | Max items to display                              | `100`   |
| `--offset <number>` | `-o`  | Items to skip                                     | `0`     |
| `--json`            |       | Output as JSON                                    | `false` |
| `--cwd <cwd>`       | `-c`  | Working directory                                 | current |

### `view` — View item details

```bash
pnpm exec shadcn view <items...> [options]
```

Displays item info including file contents. Example:
`pnpm exec shadcn view @shadcn/button`.

### `docs` — Get component documentation URLs

```bash
pnpm exec shadcn docs <components...> [options]
```

Outputs resolved URLs for component documentation, examples, and API references. Accepts one or more component names. LetZeusPost: don't fetch the URLs; builders can't reach those hosts.

Example output for `pnpm exec shadcn docs input button`:

```
base  radix

input
  docs      https://ui.shadcn.com/docs/components/radix/input
  examples  https://raw.githubusercontent.com/.../examples/input-example.tsx

button
  docs      https://ui.shadcn.com/docs/components/radix/button
  examples  https://raw.githubusercontent.com/.../examples/button-example.tsx
```

Some components include an `api` link to the underlying library (e.g. `cmdk` for the command component).

### `diff` — Check for updates

Do not use this command. Use `pnpm exec shadcn add --diff` instead.

### `info` — Project information

```bash
pnpm exec shadcn info [options]
```

Displays project info and `components.json` configuration. Run this first to discover the project's framework, aliases, Tailwind version, and resolved paths.

| Flag          | Short | Description       | Default |
| ------------- | ----- | ----------------- | ------- |
| `--cwd <cwd>` | `-c`  | Working directory | current |

**Project Info fields:**

| Field                | Type      | Meaning                                                            |
| -------------------- | --------- | ------------------------------------------------------------------ |
| `framework`          | `string`  | Detected framework (`next`, `react-router`, `start`, etc.)         |
| `frameworkVersion`   | `string`  | Framework version (e.g. `15.2.4`)                                  |
| `isSrcDir`           | `boolean` | Whether the project uses a `src/` directory                        |
| `isRSC`              | `boolean` | Whether React Server Components are enabled                        |
| `isTsx`              | `boolean` | Whether the project uses TypeScript                                |
| `tailwindVersion`    | `string`  | `"v3"` or `"v4"`                                                   |
| `tailwindConfigFile` | `string`  | Path to the Tailwind config file                                   |
| `tailwindCssFile`    | `string`  | Path to the global CSS file                                        |
| `aliasPrefix`        | `string`  | Import alias prefix (e.g. `@`, `~`, `@/`)                          |
| `packageManager`     | `string`  | Detected package manager (`npm`, `pnpm`, `yarn`, `bun`)            |

**Components.json fields:**

| Field                | Type      | Meaning                                                                                    |
| -------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `base`               | `string`  | Primitive library (`radix` or `base`) — determines component APIs and available props      |
| `style`              | `string`  | Visual style (e.g. `nova`, `vega`)                                                         |
| `rsc`                | `boolean` | RSC flag from config                                                                       |
| `tsx`                | `boolean` | TypeScript flag                                                                            |
| `tailwind.config`    | `string`  | Tailwind config path                                                                       |
| `tailwind.css`       | `string`  | Global CSS path — this is where custom CSS variables go                                    |
| `iconLibrary`        | `string`  | Icon library — determines icon import package (LetZeusPost: `lucide`, so `lucide-react` only) |
| `aliases.components` | `string`  | Component import alias (e.g. `@/components`)                                               |
| `aliases.utils`      | `string`  | Utils import alias (e.g. `@/lib/utils`)                                                    |
| `aliases.ui`         | `string`  | UI component alias (e.g. `@/components/ui`)                                                |
| `aliases.lib`        | `string`  | Lib alias (e.g. `@/lib`)                                                                   |
| `aliases.hooks`      | `string`  | Hooks alias (e.g. `@/hooks`)                                                               |
| `resolvedPaths`      | `object`  | Absolute file-system paths for each alias                                                  |
| `registries`         | `object`  | Configured custom registries (LetZeusPost: none; the official `@shadcn` registry only)     |

**Links fields:**

The `info` output includes a **Links** section with templated URLs for component docs, source, and examples. For resolved URLs, use `pnpm exec shadcn docs <component>` instead.

---

## Templates

| Value          | Framework      | Monorepo support |
| -------------- | -------------- | ---------------- |
| `next`         | Next.js        | Yes              |
| `start`        | TanStack Start | Yes              |
| `react-router` | React Router   | Yes              |
| `astro`        | Astro          | Yes              |
| `laravel`      | Laravel        | No               |

LetZeusPost: this repo uses `next` (Next.js App Router); don't scaffold a new app.

All templates support monorepo scaffolding via the `--monorepo` flag. When passed, the CLI uses a monorepo-specific template directory (e.g. `next-monorepo`). When neither `--monorepo` nor `--no-monorepo` is passed, the CLI prompts interactively. Laravel does not support monorepo scaffolding.

---

## Presets

Three ways to specify a preset via `--preset`:

1. **Named:** `--preset nova` or `--preset lyra`
2. **Code:** `--preset a2r6bw` (version-prefixed base62 string, e.g. `a2r6bw` or `b0`)
3. **URL:** `--preset "https://ui.shadcn.com/init?base=radix&style=nova&..."` (LetZeusPost: never; a URL can carry
   values nobody reviewed)

LetZeusPost: every preset change (`init --preset`, `apply`, `--force`, switching presets) needs Zeus's OK: write it
under `needs-zeus` in `.lzp/pr.md` and stop. The theme comes from `DESIGN.md` (§21).

> **IMPORTANT:** Never try to decode, fetch, or resolve preset codes manually. Preset codes are opaque — pass them directly to `pnpm exec shadcn init --preset <code>` and let the CLI handle resolution.
> Use `pnpm exec shadcn apply --preset <code>` when overwriting an existing project's preset.

## Switching Presets

Ask the user first: **overwrite**, **merge**, or **skip** existing components?

- **Overwrite / Re-install** → `pnpm exec shadcn apply --preset <code>`. Overwrites all detected component files with the new preset styles. Use when the user hasn't customized components.
- **Merge** → `pnpm exec shadcn init --preset <code> --force --no-reinstall`, then run `pnpm exec shadcn info` to get the list of installed components and use the [smart merge workflow](./SKILL.md#updating-components) to update them one by one, preserving local changes. Use when the user has customized components.
- **Skip** → `pnpm exec shadcn init --preset <code> --force --no-reinstall`. Only updates config and CSS variables, leaves existing components as-is.

Always run preset commands inside the user's project directory. `apply` only works in an existing project with a `components.json` file. The CLI automatically preserves the current base (`base` vs `radix`) from `components.json`. If you must use a scratch/temp directory (e.g. for `--dry-run` comparisons), pass `--base <current-base>` explicitly — preset codes do not encode the base.
