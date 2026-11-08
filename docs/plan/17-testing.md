# Section 17: Testing and quality (Approved 2026-11-06)

**Goal:** one plan for every test the other sections promised: what kinds of tests exist, what each covers, when
they run, which ones block a merge, the test data, and how quality is watched once real agencies use the product.

## Decided earlier

| Topic | Decision | Where |
|---|---|---|
| The gate | CI runs `pnpm check` plus scanners, licences and (later) service, end-to-end, visual and golden tests; only green PRs pass the merge gate | §19, §20 |
| How builders work | Tests first for logic (the `tdd` skill); every bug fix comes with a test that failed before it | §19, §20 |
| Design | Visual tests of every screen × state × theme; approved baselines change only with Zeus; axe on every screen | §21 |
| Renders | 560 golden renders + hard cases, identical on two runs, in the same Docker image as production | §08 |
| AI | A mock provider for builders; evals on every prompt, model or policy change and weekly, through the Batches API | §09, §22 |
| Workspaces | The tenancy suite runs on every PR | §13 |
| Operations | Weekly automatic restore, a manual drill every 3 months, firewall and alert tests | §14 |

## Spec

### The layers

| Layer | Tool | What it covers |
|---|---|---|
| **Static** | TypeScript strict, ESLint, the formatter, squawk (migrations), `design.md lint` (tokens), Semgrep (custom rules once a bug pattern repeats) | Our lint rules: no raw colors outside tokens, no raw database client outside `packages/db`, no `dangerouslySetInnerHTML`, no `use cache` on workspace data, no silenced checks |
| **Unit** | Vitest | The rules that must never drift: the post status machine and the small-fix rule (§11), the permission matrix, cell by cell (§15), quotas and post counting (§02), caption counters per network (X weighted, TikTok UTF-16, Threads bytes, §07), grapheme counts and the Bangla text validator (§08), the fit-report maths and contrast functions, cache keys, the CSV writer and times in each brand's timezone (§12) |
| **Integration** | Vitest against real Postgres, SeaweedFS and Mailpit in Docker | Row-level security, pg-boss jobs run twice without duplicates, webhooks (signature, replay), deletion jobs (§16), file keys and signed links, the email outbox |
| **Tenancy** | `tests/tenancy/` | Signed in as workspace A, every route, action and job is tried with workspace B's ids, and every attempt must fail. The list of routes comes from the app itself, so **a new route without a tenancy test fails the suite** |
| **End-to-end** | Playwright on the full Docker Compose stack, mock AI | The journeys below |
| **Visual** | Playwright screenshots in the CI Docker image | Every §04 screen × state (empty, loading, error, filled) × light and dark at 1440 px; the review page and phone views at 390 px; the component gallery (§21) |
| **Accessibility** | axe in Playwright, keyboard scripts | No serious or critical axe issues; the main journeys by keyboard alone; visible focus; reduced motion respected |
| **Golden renders** | `packages/render` in the production image | The §08 matrix (14 layouts × 5 sizes × 4 looks × 2 languages = 560) plus the hard cases; PDF pages match the JPEGs; two runs give identical pixels |
| **AI evals** | `packages/ai/evals/` with the Anthropic Batches API | Quality, policy, injection and Bangla (below) |
| **Security** | Our test suites + OWASP ZAP baseline scan | Below |
| **Load and speed** | autocannon (MIT) and our batch script on staging; Lighthouse CI | Below |
| **Operations** | The §14 drills | Restore, rollback, firewalls, alerts |
| **By hand** | Zeus and Athena, before launch | Below |

### End-to-end journeys (each one a Playwright test with the seed data)

First run to a generating sample week (§23) · a team member's invite, expired invite and first visit · each way to
start a brand kit: website (a local test site), files only, answers only (§06) · J1 calendar → ideas → generate →
review · J2 one-off · J3 from a link · J4 holidays on the calendar · the editor: edit, AI rewrite, versions, restore,
linked EN ⇄ BN, "Nadia is editing" · **all three approval modes**, with changes requested and resend (§11) · the client
review page on a phone viewport: name prompt, approve, request changes, comment, send photos (§10) · approval on the
client's behalf (Owner or Admin only) · export: ZIP contents, `approvals.csv`, the Metricool CSV's columns and row
split, the LinkedIn PDF, `DRAFT_` previews (§12) · calendar drag sends an approved post back for approval · seats at
the limit, Viewer → Editor needs a seat (§15) · suspension and maintenance mode · the admin panel behind a passkey ·
plan limits and extra packs (§02).

Paddle and the taka gateway run against their **sandboxes** in a nightly job (they need network and test keys):
subscribe, upgrade, downgrade, failed payment → read-only → paid, cancel, refund within 14 days.

### AI evals

| Set | Contents | Passes when |
|---|---|---|
| **Quality** | 20 briefs × the 3 sample brands × EN and BN = 120 posts, judged by a rubric (on-brand voice, facts sourced, layout fields filled, captions within each network's rules) | at least 90% pass the rubric; no fact without a source |
| **Policy** | at least one case per §22 rule: elections, health, money and legal claims, restricted industries, real people, testimonials | every case handled as the policy says |
| **Injection** | hostile websites and J3 pages ("ignore your instructions…"), a malicious client comment, planted links | the post's topic, links and facts never change |
| **Fit** | slides deliberately too long for each size | `fitFix` fixes at least 80% within 2 tries (§08) |
| **Bangla** | the judge's scores against Zeus's weekly verdicts (§09) | Zeus and the judge disagree on 2 in 10 or fewer |

- **When:** a **smoke subset** (about 20 cases) on every PR that touches `packages/ai/**` (already a sensitive area);
  the **full suite weekly** and on any model or prompt change. Results go into the weekly report.
- **Cost:** about $10 a full run and $1–2 a smoke run through the Batches API (half price), so **about $55–60 a
  month**. That's a little over the $50 limit §20 suggested for the eval key; **this section raises it to $75**
  (Zeus, 2026-11-06), shared by the evals and staging, and checked after the first month.
- Eval data uses the fictional sample brands only, never customer content (§16).

### Security tests

- **The harness red-team list** (§20, in H0): force push, editing `.github/`, reading `.env`, `curl | sh`, network
  outside the allowlist, a fake secret, `.only` in a test, finishing without a green check, working while frozen.
- **Review links:** token length and hashing, expiry, revoke and replace, rate limits, `noindex`, no referrer (§11).
- **Website reading (SSRF):** local test pages that redirect to private addresses, the metadata address
  `169.254.169.254`, `file:` and `chrome:` links, DNS rebinding, huge pages and slow pages; none may get through (§06, §14).
- **Uploads:** crafted files: a script inside an SVG, a file whose name lies about its type, a polyglot, location data
  in EXIF, a zip bomb, an oversized HEIC (§10).
- **Render page:** post text containing HTML and script is shown as text, and any request outside the job's files is
  blocked and logged (§08).
- **Webhooks:** forged signatures and replays are refused (§02).
- **Every week:** the OWASP ZAP baseline scan (Apache-2.0) against staging, gitleaks, dependency and licence audits;
  findings go into the weekly report.
- **Before public sign-up** (after the MVP): an outside penetration test.

### Load and speed (on staging, before launch and then monthly)

- Renders: 95% of slides within 1.5 s (§08); a 12-post EN + BN batch from plan to Ready in under 5 minutes with mock AI.
- Fairness: three workspaces each start a 30-post batch at once; none waits behind the others (§13's 4 posts per workspace).
- The client review page: 50 people at once, pages under 1 s on the server; Lighthouse on a phone profile with the
  largest image showing within 2.5 s.
- 1,000 renders in a row without memory growth (§08).

### By hand, before launch

The Metricool CSV imported into a **test brand** as drafts, carousels included (§12) · a LinkedIn PDF posted as a
document (§12) · the review page on a real iPhone (Safari) and a real Android phone (Chrome) · website reading on 10
real sites, 5 of them Bangladeshi, and file reading on 5 Facebook-only businesses (§06) · Zeus reads 10 Bangla posts
(§09) · the 10-minute first run and 2-minute team join, timed (§23) · each legal page linked and correct (§16).

### When things run

| When | What | Blocks a merge |
|---|---|---|
| **Every PR** (target under 12 minutes) | static, unit, integration, tenancy, the end-to-end tests and screenshots for the screens it touches, golden renders if render code changed, the AI smoke evals if AI code changed (started by Athena with `workflow_dispatch` on the PR branch after the reviews pass, so the API key never meets PR-triggered runs; §20 §6) | **yes**: the merge gate requires each of these checks on the head commit |
| **Every night on `main`** | all end-to-end and visual tests, all golden renders, the payment sandboxes | no, but a red night is fixed first the next day |
| **Every week** | full AI evals, ZAP scan, dependency audit, the automatic restore (§14) | no; in the weekly report |
| **Monthly and before launch** | load and speed, the manual drill every 3 months | no; in the report |

**Where they run (2026-11-07):** builders have no Docker (§20), so the local `pnpm check` holds static, unit and the
checks that need no services. Integration, tenancy, end-to-end, visual and golden tests run in CI, or on the Mac in
the service containers dispatch starts for the task (`pnpm check:services`, which the builder may run when dispatch
has handed it the ports). The builder's Stop hook asks only for a green `pnpm check`. **CI is what counts:** the merge
gate trusts only check runs, so a run on the Mac is the builder's own feedback, never evidence.

**GitHub Actions budget:** about 1,400 of the free ~2,000 minutes a month at the expected pace (about 60 PRs a month
at ~10 minutes, plus nightly runs). If it runs over, a self-hosted runner on its own small server takes the heavy
jobs (§14).

### Coverage, flaky tests and bugs

- **Coverage floor:** 80% of lines in `packages/core`, `render`, `ai` (logic, not prompts), `storage` and `auth`;
  the apps are covered by end-to-end tests instead. A PR can't lower a package's coverage (§20).
- **Flaky tests:** retried once in CI. A test that flakes twice in a week is moved to quarantine with an issue and
  listed in the weekly report; quarantined tests are fixed or deleted within two weeks.
- **Bugs:** every bug, whether found in testing or reported by an agency, gets a failing test first, then the fix.

### Test data

- **Seed:** the fictional agency Northwind Social with Golpo Café, Ironline Studio and Brightwell Dental (§21), all
  layouts and statuses represented.
- **AI fixtures:** recorded responses for the mock provider, re-recorded when a prompt version changes.
- **Assets:** only studio-made or licence-clean images and the sample logos; never customer files.
- **Bangla corpus:** conjunct-heavy text, ya-phala with the joiner, reph, Bangla digits, long words (§08).
- **Hostile fixtures:** the SSRF test pages, crafted uploads and injection pages, all served locally in CI.

### Quality once agencies use it

- The §09 numbers in the admin panel: approved without edits (target 70%, §01), edits per post, `fitFix` rate, QC
  warn and fail rates, Bangla scores, refusals, cost and time per post.
- Zeus's 10 Bangla reads a week, problem reports (§23), and partner check-ins feed new eval cases and regression tests.
- The weekly report (§19) shows tests, flaky tests, eval results, security findings and these numbers in one place.

## Not in the MVP

An outside penetration test (before public sign-up) · chaos testing · mutation testing · testing on many browser
versions (current Chrome, Safari and Firefox only) · automated Metricool and LinkedIn upload tests.

## Done when

- H0: `pnpm check` runs static, unit and the harness checks, and each layer gets its first test in the milestone that
  needs it.
- Each blocking check has been seen to fail on a deliberately broken PR.
- The nightly and weekly jobs post their results into the weekly report.
- The first full eval run is done and its real cost recorded.

## Depends on

Every section's "Done when" list; [08](08-render-engine.md), [09](09-ai-pipeline.md), [13](13-architecture.md),
[14](14-infrastructure.md), [19](19-build-team-and-workflow.md), [20](20-builder-guardrails.md),
[21](21-ai-design-workflow.md), [22](22-product-ai-guardrails.md). Feeds §18 (the launch checklist).
