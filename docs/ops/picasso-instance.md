# Picasso's instance on Zeus's Mac

Where Picasso Studio works in LetZeusPost (§18, #81): the web app, the worker, Postgres, the file store and Mailpit, as the
Compose project `letzeuspost-picasso` on OrbStack. It is separate from `pnpm dev:up` (another project, other volumes,
other secrets), and builders never reach it: it needs Docker, and their sandbox has none.

Everything runs through `node scripts/picasso.ts`, from the main checkout, at the Mac.

| What | Where |
| --- | --- |
| The app | <https://web.letzeuspost-picasso.orb.local> (OrbStack's own HTTPS domain; no host port is published) |
| Caught emails (sign-in links) | <https://mail.letzeuspost-picasso.orb.local> |
| Secrets (`.env`, mode 600) | `~/letzeuspost-picasso/`, outside every checkout and builder clone (the script refuses a folder inside one) |
| Deployed commit | `~/letzeuspost-picasso/deployed.env`; every deploy is one line in `deploys.log` |
| Backups | `~/letzeuspost-picasso/backups/`, 14 days |

The instance runs with `LZP_ENV=development` ("Zeus's Mac", §14): plain `http://` addresses are allowed between its own
containers. Each process holds only the settings `config/env.ts` lists for it; the owner role's URL reaches only the
one-off `migrate` and `seed` containers.

## First time

1. `node scripts/picasso.ts init` writes `~/letzeuspost-picasso/.env` with fresh secrets. It never prints one.
2. Deploy a main commit (below).
3. `node scripts/picasso.ts seed` asks for your email and name (or take `--email` and `--name`) and creates "Picasso Studio"
   with you as its Owner and the platform-admin flag. Running it again changes nothing. Your address is never in the repo.
4. Open the app, type your address, press "Email me a sign-in link", open the Mailpit address above and click the link.
5. `node scripts/picasso.ts install-backup` installs the nightly backup (below).

## Deploy

```sh
node scripts/picasso.ts deploy <main commit>
```

It refuses unless all of these hold, checked in this order:

1. The commit is on `origin/main` (not a branch, not a staging commit).
2. The merge gate's required checks (`requiredChecks` in `.github/merge-gate.json` on main) are all green on the pull request that merged it. The workflows run on pull requests only, so a main commit has
   no checks of its own; the script finds the merged PR for that commit and reads the check runs on its head (all finished,
   none failed; no merged PR, or no checks, is refused too).
3. Zeus said yes. At a terminal it asks you to type `yes` (it reads the terminal itself, so a pipe can't answer). Athena,
   who has no terminal, first posts the record of his yes as a comment on the issue ("Zeus decided (<date>, in chat):
   deploy <commit> …", §19 #116) and passes its URL as `--zeus-ok <URL>`. The script fetches it and refuses unless it is
   in this repository, by the signed-in GitHub user, begins exactly `Zeus decided (YYYY-MM-DD, in chat): deploy <commit>`
   (7 or more characters of the commit), was never edited, and is newer than the commit. The URL goes into `deploys.log`. Nothing else skips the question.

The web image holds the Next.js server-action key (Next writes it into the build), so images stay on this Mac: a registry or
a server needs one build per host or a key rotated at deploy.

Then it builds both images from `git archive` of that commit (never from the working folder, so a local edit can't get in),
tags them with the commit's first 12 characters, **runs the Chromium sandbox check in the worker image** (below; a failure
stops the deploy before any container is swapped), updates the instance's copy of `docker/`, starts Postgres, storage and
Mailpit, runs the migrations as the owner role, and swaps in the new web and worker containers. If a step after the
build fails, it puts the old tag back in `deployed.env` and starts the old web and worker again. The migrations only go
forward, so the old code must accept the migrated schema; if it doesn't, deploy a fixed commit.

## The worker's Chromium sandbox

The render browser (§08) runs inside the worker with Chromium's own OS sandbox on (`chromiumSandbox: true`, #350), so a
renderer exploit through a hostile font or image stays inside it, not with the worker's rights. In the image:

- The worker runs as the non-root `node` user. Chromium, pinned by `playwright-core`'s version, and the system libraries
  it needs are installed once as root into `/ms-playwright`, which only root can write.
- The sandbox needs unprivileged user namespaces, which Docker's default seccomp profile refuses. The worker container
  therefore starts under `docker/seccomp/worker-chromium.json`, with `no-new-privileges` and `cap_drop: [ALL]`: no
  capability is added, and `privileged`, `seccomp=unconfined` and `--no-sandbox` are never used (a test checks the compose
  file; the render sandbox spec checks the browser's command line).
- **The choice:** the profile is *allow by default, refuse a list*: the list is the one Docker's default profile refuses
  (`ptrace`, `mount`, `bpf`, `setns`, `kexec_load`, module loading, `perf_event_open`, `keyctl`, `process_vm_*`,
  `userfaultfd`, and so on), with `clone`, `clone3` and `unshare` left allowed because the sandbox makes its namespaces
  with them. Docker's own default is an allowlist, which is stricter against a syscall nobody has listed; this one is
  written by hand, with no copy of Docker's file, and is tested only for what it must allow and refuse. Chromium's own
  seccomp filter (inside the sandbox) is the stricter layer for the renderers. Replacing it with a full allowlist is a
  follow-up if Zeus wants that (it needs Docker's default profile as the base).
- **The check:** `node packages/render/src/browser/check-sandbox.ts` in the image, under the same options as the
  compose file. It fails if the worker is root, if Chromium has `--no-sandbox`, or if a renderer isn't under the sandbox's
  seccomp filter (`Seccomp: 2`). `deploy` runs it before swapping containers. Without the profile it fails with Chromium's
  "No usable sandbox!", which is how to tell the profile isn't applied.

## Back up

`node scripts/picasso.ts install-backup` copies `scripts/picasso-backup.ts` from `origin/main` (not from the checked-out branch) to `~/letzeuspost-picasso/bin/` and installs a
launchd job (`~/Library/LaunchAgents/com.letzeuspost.picasso-backup.plist`) that runs it at 03:00 every night. The copy is
what runs, so a checkout on any branch can't change it. A Mac that is asleep at 03:00 runs the missed job when it wakes.
Each run is a `pg_dump --format custom` into `backups/letzeuspost-<UTC time>.dump` (mode 600, written under a `.partial`
name and renamed when whole), then deletes dumps older than 14 days; the newest is always kept. The log is
`~/letzeuspost-picasso/backup.log`. By hand: `node scripts/picasso.ts backup`.

The file store (uploaded files) is not in this dump: nothing writes to it yet. Its backup comes with the first feature that does.

## Restore

The test, any time: `node scripts/picasso.ts restore-test`. It takes a fresh dump, restores it into a scratch database
(`lzp_restore_test`), compares the row count of every table with the live database, drops the scratch database, and fails
loudly on any difference. A write by the running app between the dump and the count shows as a difference: run it again. First run, 2026-11-25: 24 tables, every row count equal.

For a real restore (the data is lost or damaged), with the instance's folder as `F=~/letzeuspost-picasso`:

```sh
node scripts/picasso.ts status                      # note the running tag
docker compose --file $F/current/docker/compose.picasso.yml --env-file $F/.env --env-file $F/deployed.env stop web worker
DB=$(docker ps --quiet --filter label=com.docker.compose.project=letzeuspost-picasso --filter label=com.docker.compose.service=postgres)
docker exec $DB psql --username lzp_superuser --dbname postgres --command 'drop database letzeuspost with (force)' --command 'create database letzeuspost owner lzp_owner'
docker exec -i $DB pg_restore --username lzp_superuser --dbname letzeuspost --no-owner --exit-on-error < $F/backups/<the dump>
docker compose --file $F/current/docker/compose.picasso.yml --env-file $F/.env --env-file $F/deployed.env start web worker
```

If the whole volume is gone, `up` on an empty volume runs `docker/postgres/roles.sh` again, which creates the roles; then
restore as above.

## Not in this setup

A server, a domain, Google sign-in (§18). The instance runs with `LZP_ENV=development` (§14 allows it for Zeus's Mac): sign-in cookies are not marked `Secure`, and the sign-in rate limit keys on `x-forwarded-for`, which a client can set. That is acceptable only because the instance is reachable from this Mac alone (no host ports); revisit it before any other machine or a domain reaches it. The browser-facing address of the file store: the web app reaches it as
`http://storage:8333` inside the project, which is right until a feature hands a signed file address to the browser; that
feature's task decides how the store is shown (#81 leaves it).
