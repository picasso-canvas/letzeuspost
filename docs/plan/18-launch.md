# Section 18: Design-partner launch (Approved 2026-11-06)

**Goal:** what's in the first launch, the build milestones in their final order, what "ready to launch" means, how
the design partners are started, supported and listened to, how success is measured, and what follows right after.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Who are the first design partners? | **1–3 Bangladeshi agencies Zeus knows** |
| Launch timing? | **Earlier and smaller: aim for January 2027** |
| Networks at launch? | **All 7** |
| Jobs at launch? | **All 4** (J4 with the hand-made Bangladesh list, §01) |
| What moves to right after launch? | **Product cutouts · client photo uploads · two of the four looks (Bold, Editorial) · four extra layouts (testimonial, photo card, meme, before/after)** |
| When is billing built? | **Right after launch**, finished before the first partner's 3 free months end |
| Legal documents before real client data? | **The partner agreement first**; the lawyer's review of the full documents lands before billing |

## Spec

### What's in the January launch

| Area | At launch | Right after launch |
|---|---|---|
| Networks and sizes | all 7 networks, all 5 sizes (§07) | |
| Jobs | J1 calendar, J2 one-off, J3 from a link, J4 holidays (Bangladesh list) | worldwide holiday data (§01) |
| Languages | English and Bangla, linked versions (§01) | |
| Layouts | **10 core**: cover, fact, step, list, quote, stat, question, offer, cta, text | testimonial, photo card, meme, before/after |
| Looks | **Playful and Clean**, with the switches (§07) | Bold, Editorial |
| Images | brand library, type-only layouts, crop and focus, HEIC via Cloudflare (§10, §16) | client photo uploads, product cutouts; then stock and AI images (§01) |
| Review | the editor, versions, all three approval modes, the client review link (approve, comment, request changes) | "Add photos" on the review page |
| Export | ZIP, Metricool CSV, LinkedIn PDF, provenance metadata (§12, §16) | |
| Accounts and admin | workspaces, roles, invites, seats, the admin panel with its extras (§15) | |
| Billing and public page | manual: partners are free (§02) | Paddle, taka invoices, the public page (§02, §03) |

The golden renders at launch: 10 layouts × 5 sizes × 2 looks × 2 languages = **200** (the rest arrive with their
layouts and looks, §08).

### The build milestones (final order)

| Milestone | Builds | Sections | Rough length |
|---|---|---|---|
| **H0 Harness** | guardrails, agent files, skills, CI gates, the red-team list | 19, 20, 21 | 1 week |
| **M0 Foundation** | repo and Docker Compose, design tokens and the component gallery, sign-in (Google, email link, invite codes, invitations), workspaces, roles and permissions, the schema with row-level security and the tenancy suite, jobs, storage, config files, the staging server | 13, 14, 15, 21 | 2 weeks |
| **M1 Render engine** | the HTML builder, 10 layouts, 2 looks, 5 sizes, fonts, the Bangla checks, the fit report, JPEG, PNG and PDF, the 200 goldens | 07, 08 | 1.5 weeks |
| **M2 Brand kits** | new brand from a website (the fetcher), files or answers; the kit editor with Facts; the asset library and upload processing | 06, 10 | 1.5 weeks |
| **M3 Generate** | the AI pipeline (all tasks), J1–J4, QC and the Bangla judge, costs and caps, the evals | 09, 22, 01 | 2 weeks |
| **M4 Review** | the editor, versions, approval modes, the review link, comments, notifications, emails, the first run and the checklist | 11, 23 | 1.5 weeks |
| **M5 Export and calendar** | ZIP, Metricool CSV, LinkedIn PDF, provenance metadata, the calendars | 12 | 1 week |
| **M6 Launch readiness** | the production servers, backups and restore, monitoring and the runbook, the admin panel, the launch checklist below | 14, 15, 16, 17 | 1 week |
| **→ Launch** | the first design partner starts | | |
| **M7 Billing and public page** | Paddle, taka invoices with pay links, the public page, the legal documents live | 02, 03, 16 | 1.5 weeks; **due before the first free period ends** |
| **M8 After-launch features** | client photo uploads, cutouts, Bold and Editorial, the four extra layouts, in the order partners ask for them | 07, 10, 11 | as needed |

**About 11.5 weeks to launch.** Starting in the week of 10 November, that lands in the last week of January 2027.
It's an estimate: Zeus reviews and merges every PR, which sets the pace, and the weekly report (§19) tracks it. If the
plan slips, scope moves to M8 before quality drops.

### Ready to launch (the checklist)

**Product**
- Every launch journey in §17 passes on staging, then on production.
- Zeus has approved the 200 golden renders and read 10 sample Bangla posts.
- The AI evals meet their thresholds (§17).
- The by-hand checks are done (§17): a Metricool import into a test brand, a LinkedIn PDF, real phones, 10 real
  websites (5 Bangladeshi), 5 Facebook-only businesses, and the 10-minute first run timed.

**Safety and operations**
- The tenancy suite, the security tests (website reading, uploads, review links) and the harness red-team list pass.
- The AI caps stop generation in a test.
- Production is built with the setup script; backups run and one restore has passed; alerts and rollback are tested.

**Legal (partner agreement first)**
- Each partner signs the partner agreement, which covers in plain words what §16's documents will say in full: they
  own their content, what LetZeusPost does with it, the services that receive it (EU storage, Anthropic), deletion
  after 30 days, Zeus's logged support access, and the free 3 months then 50% off.
- The draft terms and privacy policy are shared with partners; the lawyer's review is done before billing (M7).
- With Bangladeshi partners only, no EU or UK representatives are needed yet (§16).

**Zeus's accounts** (Zeus creates them; keys never pass through chat): the domain, the Anthropic production key with a
spend limit, the Google sign-in app, Resend with the domain verified, Sentry in the EU region, Cloudflare (R2 EU
buckets, Images, Pages, Access, Email Routing), the Hetzner servers, UptimeRobot.

### Starting the partners

- **Staggered:** the first partner at launch, the second a week or two later, the third once the first two's top
  problems are fixed. One person supporting three new agencies at once is too many.
- Each one follows §23's playbook: a personal note, the agreement, a 45-minute kickoff on screen share (their goals,
  how they make posts today, 1–2 real client brands, their team, Metricool, how their clients approve), then the
  first real calendar together in week 1.
- An invite code from the admin panel (§15), their own workspace, and Agency-plan limits that Zeus can raise.

### Listening, fixing and support

- **Daily:** email with Zeus and the in-app Report a problem button (§23). Replies within the same Dhaka working day;
  outages faster (§14).
- **Weekly:** a 20-minute call per partner: their numbers, their top 3 problems, what changed since last week.
- **Every report and call note becomes a GitHub issue** labelled `partner-feedback`. Athena sorts them weekly with Zeus:
  a fix within a week, or an honest "not yet, because…". Each fix comes with a test (§17).
- What partners ask for decides the order of M8.

### Measuring success (from §01, over 6–8 weeks)

| Measure | Target |
|---|---|
| They pay | at least 1 partner moves to a paid plan when its free months end |
| Time saved | a month of posts for one brand in under an hour, from new batch to export |
| Few edits | 70% or more of posts approved with no or small edits |
| Weekly use | every partner exports at least one batch a week for a real client |

The admin panel shows them per partner (§15), the weekly report tracks them, and each partner's free period ends with
a review of these numbers together, a plan offer (§02) and, if they're happy, a testimonial with their consent.

### After launch

| When | What |
|---|---|
| Weeks 1–4 | Partner fixes; **M7** billing and the public page; the lawyer's review; the trademark clearance search and, if clear, the Bangladesh filing (§03) |
| Weeks 4–12 | **M8** features in the order partners ask; the second and third partners |
| Around month 3 | The first free period ends: billing goes live for that partner; decide what's next (public sign-up, stock photos, AI images, partners abroad) |

### On the board (done on approval)

- The repo milestones are renamed to this order (M5 Export and calendar, M6 Launch readiness, M7 Billing and public
  page) and **M8 After-launch features** is created.
- Athena turns the approved sections into build tasks for **H0 first** (§19), then M0 onwards, each with its section
  links, Done-when checklist and areas; the board shows them as Kind "Build task".
- §01, §07, §08, §10 and §11 note which parts are "right after launch".

## Not in the MVP

Public sign-up · partners outside Bangladesh at launch · a launch announcement or marketing push · a support desk
tool (email and the in-app button first).

## Done when

- The first design partner has a working workspace with a real client brand and has exported a real month.
- Every item on the launch checklist is ticked, with links to the evidence.
- The weekly report shows the four success measures for each partner from their first week.
- M7 ships before the first free period ends.

## Depends on

Every section; especially [01](01-product-spec.md), [02](02-pricing-and-billing.md), [14](14-infrastructure.md),
[15](15-accounts-and-admin.md), [16](16-legal-and-trust.md), [17](17-testing.md), [19](19-build-team-and-workflow.md)
and [23](23-onboarding.md).
