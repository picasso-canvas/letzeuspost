# LetZeusPost: planning roadmap

**Rule from Zeus (2026-11-06):** plan every section properly before writing a single line of code. Each section gets
its own detailed plan, and Zeus approves it. Building starts only from approved sections.

## Decided in the first interview (2026-11-06)

| Topic | Decision |
|---|---|
| Product | Social posts generator (one narrow tool first; video later) |
| Buyer | Agencies / marketing teams with many client brands |
| Market / languages | Global, English first; English + Bangla at launch |
| First users | 1–3 agencies Zeus knows, invite-only design partners |
| First build | Working MVP |
| Brand setup | From the client's website, **or files (logo + recent posts) or 8 quick answers for brands without a website**; the agency adjusts |
| Images | At launch: brand library, type-only layouts, photos the client sends by review link, product cutouts on our server; stock search and AI generation right after (§10) |
| Editing | Form edit + live preview + AI rewrite |
| Approval | Set per brand: none / agency / agency + client |
| Publishing | Export first: ZIP, LinkedIn PDF, **Metricool** CSV (Buffer/Hootsuite later); direct scheduling in v2 |
| Models / providers | Config files, swappable per task |
| Hosting | Athena decides in Section 14 (draft: one Hetzner VPS + Cloudflare R2) |
| Payouts | Not decided yet (Section 2) |
| Name | LetZeusPost (letzeuspost.com and .ai were free on 2026-11-06) |
| Builder | Claude Code, from this repo and the GitHub Project board |
| Merging | **Zeus merges every PR** (GitHub Free can't enforce merge rules on a private repo); agents only open PRs ([19](19-build-team-and-workflow.md)) |
| Sensitive areas | Auth / permissions / billing, database migrations, dependencies, AI prompts and rules, the guardrails and CI themselves: CI labels those PRs `sensitive` ([20](20-builder-guardrails.md)) |
| Agent identity | Zeus's account through a **repo-only token** (no settings, secrets or workflow access); a bot account was tried and suspended |
| Outside skills | About 100 rated ([research/skills.md](research/skills.md)); MIT/Apache + CC-BY-SA text; pinned copies only |

## The sections

✋ = needs Zeus's answers in an interview round. The others Athena drafts and Zeus approves.

| # | Section | Part | ✋ | Status | Doc | Issue |
|---|---|---|---|---|---|---|
| 1 | Product spec | A Product & business | ✋ | **Approved** 2026-11-06 | [01-product-spec.md](01-product-spec.md) | [#1](https://github.com/picasso-canvas/letzeuspost/issues/1) |
| 2 | Pricing, plans and billing | A Product & business | ✋ | Not started | 02-pricing-and-billing.md | [#2](https://github.com/picasso-canvas/letzeuspost/issues/2) |
| 3 | LetZeusPost brand | A Product & business | ✋ | Not started | 03-letzeuspost-brand.md | [#3](https://github.com/picasso-canvas/letzeuspost/issues/3) |
| 4 | User flows and screens | B Experience | ✋ | **Approved** 2026-11-06 | [04-flows-and-screens.md](04-flows-and-screens.md) | [#4](https://github.com/picasso-canvas/letzeuspost/issues/4) |
| 5 | App design | B Experience | ✋ | Draft (direction approved, mockups next) | [05-app-design.md](05-app-design.md) | [#5](https://github.com/picasso-canvas/letzeuspost/issues/5) |
| 6 | Brand kits | C Engine | | **Approved** 2026-11-06 | [06-brand-kits.md](06-brand-kits.md) | [#6](https://github.com/picasso-canvas/letzeuspost/issues/6) |
| 7 | Posts: types, layouts, sizes, looks | C Engine | ✋ | **Approved** 2026-11-06 | [07-posts.md](07-posts.md) | [#7](https://github.com/picasso-canvas/letzeuspost/issues/7) |
| 8 | Render engine | C Engine | | Not started | 08-render-engine.md | [#8](https://github.com/picasso-canvas/letzeuspost/issues/8) |
| 9 | AI pipeline | C Engine | ✋ | **Approved** 2026-11-06 | [09-ai-pipeline.md](09-ai-pipeline.md) | [#9](https://github.com/picasso-canvas/letzeuspost/issues/9) |
| 10 | Images | C Engine | ✋ | Draft (waiting for Zeus) | [10-images.md](10-images.md) | [#10](https://github.com/picasso-canvas/letzeuspost/issues/10) |
| 11 | Review, editing and approvals | D Collaboration & output | ✋ | Not started | 11-review-and-approvals.md | [#11](https://github.com/picasso-canvas/letzeuspost/issues/11) |
| 12 | Export and calendar | D Collaboration & output | | Not started | 12-export-and-calendar.md | [#12](https://github.com/picasso-canvas/letzeuspost/issues/12) |
| 13 | Technical architecture | E Platform | | Draft (assumptions only) | [13-architecture.md](13-architecture.md) | [#13](https://github.com/picasso-canvas/letzeuspost/issues/13) |
| 14 | Infrastructure and operations | E Platform | | Not started | 14-infrastructure.md | [#14](https://github.com/picasso-canvas/letzeuspost/issues/14) |
| 15 | Accounts, team and owner admin | E Platform | ✋ | Not started | 15-accounts-and-admin.md | [#15](https://github.com/picasso-canvas/letzeuspost/issues/15) |
| 16 | Legal and trust | E Platform | ✋ | Not started | 16-legal-and-trust.md | [#16](https://github.com/picasso-canvas/letzeuspost/issues/16) |
| 17 | Testing and quality | E Platform | | Not started | 17-testing.md | [#17](https://github.com/picasso-canvas/letzeuspost/issues/17) |
| 18 | Design-partner launch | E Platform | ✋ | Not started | 18-launch.md | [#18](https://github.com/picasso-canvas/letzeuspost/issues/18) |
| 19 | Build team and workflow | F Building with AI | ✋ | **Approved** 2026-11-06 (stack details pending §13) | [19-build-team-and-workflow.md](19-build-team-and-workflow.md) | [#19](https://github.com/picasso-canvas/letzeuspost/issues/19) |
| 20 | Builder guardrails | F Building with AI | ✋ | **Approved** 2026-11-06 (stack details pending §13) | [20-builder-guardrails.md](20-builder-guardrails.md) | [#20](https://github.com/picasso-canvas/letzeuspost/issues/20) |
| 21 | AI design workflow | F Building with AI | ✋ | **Approved** 2026-11-06 (stack details pending §13) | [21-ai-design-workflow.md](21-ai-design-workflow.md) | [#21](https://github.com/picasso-canvas/letzeuspost/issues/21) |
| 22 | Product AI guardrails | F Building with AI | ✋ | **Approved** 2026-11-06 (stack details pending §13) | [22-product-ai-guardrails.md](22-product-ai-guardrails.md) | [#22](https://github.com/picasso-canvas/letzeuspost/issues/22) |
| 23 | Onboarding | B Experience | ✋ | **Approved** 2026-11-06 | [23-onboarding.md](23-onboarding.md) | [#23](https://github.com/picasso-canvas/letzeuspost/issues/23) |

What each section decides:

1. **Product spec:** users and roles, the four jobs, networks, principles, what waits for v2, success measures.
2. **Pricing, plans and billing:** tiers, quotas, what counts as a post, trial, design-partner terms, the billing provider (decided by how Zeus gets paid), invoices and tax.
3. **LetZeusPost brand:** logo, colors, voice, tagline, domain purchase and trademark check (a studio brand kit).
4. **User flows and screens:** sitemap, every screen, journeys, empty, loading and error states, notifications.
5. **App design:** the app's design system, then clickable mockups Zeus approves.
6. **Brand kits:** what a kit holds, website extraction step by step, the brand editor, the asset library.
7. **Posts:** post types and layouts, sizes per network and caption limits, the 4 look presets, the post content schema.
8. **Render engine:** port of the studio renderer, the HTML builder shared by preview and final render, Chrome in Docker, fonts (Bangla included), the fit report and auto-shortening.
9. **AI pipeline:** every AI task (brand profile, plan, write, rewrite, fit fix, QC, asset tagging), prompts, quality rules, the model and provider config files, cost logging, AI quality tests.
10. **Images:** brand library, stock search, AI image generation, the synthetic label, licences and credits.
11. **Review, editing and approvals:** the post editor, versions, the three approval modes, the client link, comments, emails.
12. **Export and calendar:** ZIP, LinkedIn PDF, Buffer / Hootsuite / Metricool CSV, the calendar, the v2 scheduling outline.
13. **Technical architecture:** stack, repo layout, data model, auth and workspaces, the job queue, storage, API, security.
14. **Infrastructure and operations:** hosting, environments, deploys, backups and restore, monitoring, secrets, monthly cost.
15. **Accounts, team and owner admin:** workspaces, the permission matrix, invites, usage meters, Zeus's admin panel.
16. **Legal and trust:** terms, privacy, the data agreement agencies need (GDPR), AI disclosure, content and licence rules.
17. **Testing and quality:** unit, golden renders, end-to-end, AI evals, load and security tests.
18. **Design-partner launch:** onboarding, feedback loop, success tracking, support, the build milestones in final order.
19. **Build team and workflow:** the agents (Daedalus builds; Argus, Cerberus and Iris review), a task's life from issue to a PR Zeus merges, the weekly report, skills per agent.
20. **Builder guardrails:** the repo-only token, sandbox, deny rules, hooks, checks, the risk gate, Zeus merging, secrets, usage caps, rules for outside skills.
21. **AI design workflow:** mockups → `DESIGN.md` tokens → component gallery → visual tests, Iris's review, the chosen design skills.
22. **Product AI guardrails:** prompt-injection defences, the content policy, output checks, cost caps, audit, evals.
23. **Onboarding:** the agency's first run, the getting-started checklist, team members joining, the client's first review, onboarding emails, the design-partner playbook, onboarding measures.

## Planning order

1 → 4 → 5 → 7 → 6 → 9 → 10 → 11 → 12 → 8 → 13 → 15 → 2 → 3 → 16 → 14 → 17 → 18

Part F (19–22) was planned out of order on 2026-11-06, at Zeus's request, so the building rules exist before any code.

The product first, then what users see, then the engine that serves it, then the platform under it, then the launch.
[drafts/first-proposal.md](drafts/first-proposal.md) holds the first, unapproved draft of the architecture, hosting,
pricing and milestones, as a starting point for Sections 2, 6, 8, 9, 12, 13, 14 and 18.

## How work moves on the board

Each section is one issue (label `section`). Its **Status** moves:

**Not started → Interview → Draft → Approved**

Every section doc follows [_section-template.md](_section-template.md): Goal · Questions for Zeus · Spec · Not in the
MVP · Done when · Depends on.

When the sections a build milestone needs are approved, Athena breaks them into **build-task** issues (label
`build-task`, a repo milestone and a "Done when" checklist) and moves them to **Ready to build** (Zeus can pull any
back). The first milestone is **H0 Harness**: the guardrails are built before any product code. Then:

**Ready to build → In progress → In review → Done**

`needs-zeus` = waiting on Zeus's answer or approval. `blocked` = something else is missing (the comment says what).
`sensitive` / `routine` = the tier the CI risk gate gives a PR. `audit` = the weekly report. **Zeus merges every PR.**
