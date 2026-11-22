# LetZeusPost

On-brand social posts for agencies. LetZeusPost plans, writes, designs and checks a month of posts for each of an
agency's client brands, in English or native Bangla. The agency edits and approves, the client approves from a link,
and the posts are exported ready to schedule.

**Status: building.** Every section of the plan is approved by Zeus (the owner). The harness and the first screens
(sign-in, workspaces, the shared UI kit) are built; the brand kit and the AI pipeline come next.

| | |
|---|---|
| The plan | [docs/plan/00-roadmap.md](docs/plan/00-roadmap.md): all 23 sections, their status and links |
| The board | [GitHub Project **LetZeusPost**](https://github.com/users/picasso-canvas/projects/2): one issue per section (#1–#23), and build tasks later |
| Rules for the building agent | [CLAUDE.md](CLAUDE.md) |

## Run it locally

You need Node, pnpm and Docker (Docker Desktop or OrbStack), running.

```sh
pnpm install
pnpm dev:up
```

`pnpm dev:up` writes a local `.env` with fresh secrets the first time (it is never committed), starts Postgres, file
storage and Mailpit, applies the migrations, seeds the demo agency Northwind Social, and runs the web app and the
worker. Open <http://localhost:3100> and sign in as `nadia@northwind.invalid`; the sign-in link arrives in Mailpit at
<http://localhost:8025>. Ctrl-C stops the app; `pnpm dev:up --down` stops the services, and `--down --reset` also
deletes their data.

Made by the editz studio.
