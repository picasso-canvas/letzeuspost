# Section 16: Legal and trust (Approved 2026-11-06)

**Goal:** the legal documents, who is responsible for which data, where data lives and for how long, the data laws
that apply (GDPR, UK GDPR, Bangladesh's 2026 Act, the EU AI Act), the rules customers agree to about content and AI,
and what a lawyer checks before launch. **Not legal advice:** the facts below were checked on 2026-11-06 from official
sources, and a lawyer reviews everything before the public page goes up.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Who writes the legal documents? | **Athena drafts them from the plan, a lawyer reviews** (Bangladesh + GDPR) |
| How long is deleted data kept? | **30 days**, then erased; backups roll it out within 30 more days |
| Whose law governs the agency contract? | **Bangladesh**, Dhaka courts (the lawyer confirms) |
| AI labels on posts? | **What the law requires**: AI images labelled synthetic; human-approved text needs no visible label |
| Where is data stored? | **The EU** (Hetzner in Germany or Finland, Cloudflare R2 EU buckets) |
| EU and UK representatives (GDPR Art. 27)? | **Appointed when the first EU or UK agency signs up** |
| iPhone HEIC photos? | **Cloudflare converts them** (Cloudflare Images), so our servers never decode HEIC; this replaces part of §13's A14 |

## Spec

### The documents

Plain English, drafted by Athena from the approved sections, reviewed by the lawyer, linked from the public page and
the app's footer (Paddle requires Terms, Privacy and Refunds in the site's navigation, the company named, HTTPS).

| Document | Key points |
|---|---|
| **Terms of Service** (with each agency) | Between Zeus's Bangladeshi company and the agency; business use only. Accounts and roles (§15). **The agency owns its uploads and its posts**; LetZeusPost may process them only to run the service, and **no AI model is trained on them** (§09; Anthropic's terms say the same). AI drafts can be wrong: the agency reviews and is responsible for what it publishes; no promise of reach or platform acceptance. Fees, Paddle as the reseller abroad, refunds (§02). Suspension and ending (§15, §02). Zeus's read-only support access, logged and shown (§15). Liability capped at the fees paid in the 12 months before a claim. Bangladesh law, Dhaka courts. Changes announced 30 days ahead |
| **Privacy policy** | What's collected (accounts, client reviewers' names and emails, usage, billing through Paddle or the gateway), why, the legal bases, the sub-processors, transfers, retention, people's rights under GDPR, UK GDPR and Bangladesh's Act, how to ask, the EU and UK representatives once appointed, cookies |
| **Data processing agreement (DPA)** | For agencies, accepted in Settings (click-through, with a PDF copy). Everything GDPR Art. 28 requires (list below), **EU standard contractual clauses (Module 2) and the UK Addendum**, since Bangladesh has no EU adequacy decision. The lawyer checks the Commission's caveat that these clauses don't fit importers already under GDPR via Art. 3 |
| **Refund policy** | §02: a full refund within 14 days of the first payment, then none for partial periods (matches Paddle's 14 days) |
| **Acceptable use** | The §22 content policy in plain words, plus the content rules below |
| **Sub-processors** | A public list (below); 30 days' notice of changes, and agencies may object |
| **Cookies** | Essential cookies only (sign-in, security, theme); no trackers anywhere |
| **Open-source licences** | The licence page: LGPL notice for libvips (inside sharp), OFL for the fonts, and the rest |
| **Design-partner agreement** | §23 and §02: free for 3 months, then 50% off for a year; weekly feedback; a testimonial only with consent; their data stays theirs |

**DPA contents (GDPR Art. 28(3)):** subject, duration, nature and purpose, types of data and people; the processor acts
only on the agency's documented instructions (transfers included), keeps staff bound to confidentiality, applies
proper security (Art. 32), uses sub-processors only with authorisation and the same duties, helps with people's
requests, security, breaches and impact assessments, deletes or returns data at the end, and gives audit information
(and flags instructions that break the law).

### Who is responsible for which data

| Data | LetZeusPost's role | Covered by |
|---|---|---|
| Agency staff accounts, billing contacts, usage and logs | **Controller** | Privacy policy |
| What agencies upload and make: client brand kits and facts, photos, posts, comments, **client reviewers' names and emails**, photos clients send | **Processor** for the agency | DPA |
| Zeus's support views (§15) | Processor, acting for support and quality as the DPA allows; every view logged | DPA, Terms |

### Where data lives, and the sub-processors

| Sub-processor | What | Where |
|---|---|---|
| **Hetzner** | Servers, database, backups | EU (Germany or Finland; §14 picks) |
| **Cloudflare** | Files (R2 **EU jurisdiction** buckets), DNS, **HEIC conversion** (Images) | EU storage; conversion on Cloudflare's network |
| **Anthropic** | AI processing of prompts | **US or global** (no EU-only option); inputs and outputs deleted within 30 days; **never used for training**; its DPA includes the EU clauses and UK Addendum |
| **Resend** | Email | EU region if offered (checked at build) |
| **Sentry** | Error reports, scrubbed of personal data | EU region if offered (checked at build) |
| **Paddle** | Payments abroad (merchant of record) | Paddle's own terms |
| **Local gateway** | Taka payments | Bangladesh |
| **Google** | Sign-in only | — |

- Anthropic's zero-data-retention option exists by agreement; LetZeusPost asks for it if a customer requires it. Customer
  content never goes through the Batch or Files APIs (the evals' Batch runs use test data only, §09).
- Nothing else receives customer data. Adding a sub-processor is a `sensitive` change (§20) and starts the 30-day notice.

### Keeping and deleting

| What | Kept |
|---|---|
| A deleted workspace, or one whose plan ended | Read-only for 30 days after cancelling (§02); then, and on deletion, **kept 30 days** (Zeus can restore it on request), then erased, with backups rolling it out within **30 more days** (§14 keeps backups at most 30 days) |
| A deleted brand | The same 30-day window, then erased with its examples and lessons (§09) |
| Exports and public image links | 30 days; links until 7 days after the last post date (§12) |
| Server logs | 30 days |
| Audit events (§13) | As long as the workspace, then erased with it |
| AI usage and billing records | Cost figures without any content, kept for accounts and tax as the law requires |

### People's rights and breaches

- Requests (access, correction, deletion, portability, objection) go to `privacy@letzeuspost.com` and are answered
  within 30 days. For client data, LetZeusPost passes the request to the agency (the controller) and helps; the data
  download (§15) covers portability.
- **Breaches:** affected agencies are told **within 48 hours** of confirming one, with what's known; LetZeusPost helps
  them meet their 72-hour GDPR deadline, and tells Bangladesh's Authority when significant harm is likely. The
  breach runbook is in §14.

### The laws that apply

- **GDPR and UK GDPR:** LetZeusPost offers its service to people in the EU and UK (agency staff), so they apply.
  **EU and UK representatives** (Art. 27; about €420 a year each from a service such as Prighter) are appointed before
  the first EU or UK agency starts, and named in the privacy policy.
- **Bangladesh, Personal Data Protection Act 2026** (Act 63 of 2026, which replaced the 2025 Ordinance): it covers
  Zeus's company and anyone offering services to people in Bangladesh. Sending data abroad is allowed with consent or
  under a contract, so the Terms and privacy policy say where data goes and why. Rules on "appropriate" storage abroad
  and data classes are still to be issued: watched, and the lawyer checks them when they come. Its fines start only
  when the government sets a date (about 18 months on). **LetZeusPost never asks for national ID, passport, tax-ID or
  biometric data**, and the upload rules forbid ID documents, which also avoids the Act's notification duty for them.
- **EU AI Act, Article 50** (since 2 August 2026): content made by AI must carry a machine-readable mark, and
  deepfakes must be disclosed. Text published to inform the public needs a visible label unless people reviewed it and
  someone is editorially responsible; ordinary marketing posts are most likely outside that. So:
  - **Exported images carry provenance metadata** (C2PA where supported, otherwise XMP/IPTC) saying how they were made:
    AI images (after launch) are marked **synthetic**; designs with real photos and AI-written text are marked
    **"AI-assisted"**, never with the synthetic flag, so platforms don't label real photos as AI.
  - `post.json` and the ZIP's README record the same (§12), and every post records who approved it (§11).
  - The lawyer confirms whether LetZeusPost counts as a "provider" under Art. 50(2) and checks the approach against
    the Commission's June 2026 code of practice on marking.
- **Platform rules:** the export README tells agencies that Meta, TikTok and YouTube expect realistic AI imagery to be
  labelled when posting (relevant once AI images exist).
- **Cookies:** essential cookies only and product events recorded on the server, with no tracking scripts, so **no
  cookie banner** is needed; the cookie notice says so.

### Content and licence rules (what agencies agree to)

- They have the rights to everything they upload: photos, logos, fonts (the licence tick, §08) and documents.
- **Recognisable people** need their consent (the tick, §10); **testimonials** need the customer's agreement (§07);
  AI images never show real people (§22).
- The §22 policy: no election or campaign content, restricted industries only when the kit declares them, no
  deceptive content or impersonation, claims about health, money or law confirmed.
- **No ID documents or sensitive personal data** in uploads.
- **Takedown:** a rights holder emails `hello@`; LetZeusPost acts within 5 working days and tells the agency.
  Repeated or serious abuse leads to suspension (§15).

### Before the public page goes up (Zeus + the lawyer)

1. The lawyer reviews the Terms, privacy policy, DPA, refund policy and acceptable use; Bangladesh law plus GDPR.
2. The company's legal name and address are on the site (Paddle requires them).
3. The trademark clearance search is back (§03).
4. The sub-processor list and the licence page are published.
5. Before the first EU or UK agency: the two representatives are appointed.

### Changes to other sections (made on approval)

- **§13 (A14) and §10:** HEIC is converted by **Cloudflare Images**, not decoded on our servers; libheif and libde265
  leave the plan. **§20:** the LGPL exception covers libvips only. **§08:** its HEIC note points here.
- **§14:** EU region for servers, R2 EU jurisdiction buckets, backups kept at most 30 days, Resend and Sentry EU
  regions where offered, and the breach runbook.
- **§12:** exports write provenance metadata, and the README covers platform AI labels.
- **§22:** uploads must not contain ID documents or sensitive personal data.

## Not in the MVP

SOC 2 or ISO 27001 · custom contracts per customer · a choice of data region per customer · Anthropic zero data
retention (on request later) · a Bangla version of the legal documents · an in-app privacy-request form (email first).

## Done when

- The documents are drafted, reviewed by the lawyer, and linked from the public page and the app.
- Agencies accept the DPA in Settings and can download it; the sub-processor and licence pages are live.
- The deletion jobs are tested: a deleted workspace is restorable for 30 days, then erased from the database and the
  files, and gone from backups within 30 more days.
- Exported images carry the right provenance metadata (checked with a metadata reader), and AI images can never be
  exported without the synthetic mark.
- A test privacy request and a test breach drill follow the procedures within their deadlines.

## Depends on

[02](02-pricing-and-billing.md), [03](03-letzeuspost-brand.md), [09](09-ai-pipeline.md), [10](10-images.md),
[11](11-review-and-approvals.md), [12](12-export-and-calendar.md), [13](13-architecture.md),
[15](15-accounts-and-admin.md), [22](22-product-ai-guardrails.md), [23](23-onboarding.md). Feeds §14 (region,
backups, breach runbook) and §18 (the launch checklist).
