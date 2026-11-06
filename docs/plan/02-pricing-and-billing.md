# Section 2: Pricing, plans and billing (Draft, waiting for Zeus)

**Goal:** the plans and what they include, what counts as a post, the design-partner terms, how agencies abroad and in
Bangladesh pay, invoices and tax, and what happens when a payment fails or someone cancels.

Mockups (version 10): https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe (screen "Settings: plan & usage").

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Where can Zeus receive money? | A Bangladeshi bank account, Payoneer, a Bangladeshi company, and a company abroad if needed |
| Where are the first paying agencies? | **Bangladesh and abroad** from the start |
| Does a linked EN + BN pair count as one post? | **No: each language counts** (each is written and checked separately) |
| Design-partner terms? | **Free for 3 months, then 50% off for the first year** |
| Plan shape? | **Three tiers** (Starter, Agency, Scale) |
| Running out of posts? | **Extra post packs**, with upgrading offered too |
| Annual billing? | **2 months free** |
| Refunds? | **Full refund within 14 days of the first payment**; after that, cancel any time, no partial refunds |
| Payment provider? | Zeus first said Stripe. Stripe needs a company abroad, which needs Bangladesh Bank's permission, so **Paddle first** (through the Bangladeshi company), **Stripe later** if a US company happens |
| Bangladeshi agencies pay in? | **Taka**, at **about half the dollar price**, with **fewer posts** so AI costs stay covered |
| Which company abroad? | **Decided with an accountant** if and when Stripe is added |

## Spec

### Plans

| | Starter | Agency | Scale |
|---|---|---|---|
| **Abroad (USD)** | **$49** / month | **$129** / month | **$299** / month |
| Posts a month | 80 | 300 | 1,000 |
| **Bangladesh (BDT, plus VAT)** | **৳2,900** / month | **৳7,900** / month | **৳17,900** / month |
| Posts a month | 60 | 200 | 500 |
| Brands | 3 | 10 | 30 |
| Seats (Owner, Admins, Editors; Viewers free, §15) | 2 | 5 | 15 |
| Storage for uploads | 10 GB | 50 GB | 200 GB |
| **Annual** | 10 × the monthly price (2 months free), posts still reset monthly | | |

- **Everything else is the same on every plan:** all 7 networks, all 4 jobs, English and Bangla, the 4 looks, client
  review links, every export. Plans differ only in amounts.
- **Taka prices** are about half the dollar price at ৳124.34 per dollar (Bangladesh Bank, 5 Nov 2026). Posts are fewer
  because AI is paid in dollars (see Costs). VAT is added on top (rate below).
- **A workspace's currency** comes from its country when Zeus creates the invite code: Bangladesh → taka, anywhere
  else → dollars. Zeus can change it.
- AI images (after launch) get their own monthly amount per plan, set when they are planned.

### What counts as a post

- **One post in one language** = 1, in every size and output its networks need.
- **A linked EN + BN pair = 2** (Zeus).
- **Regenerate with a note** = a new post (§01).
- **Free:** ideas and planning, brand kits (reading websites and files), edits, AI rewrites, automatic fit fixes, QC,
  the Bangla judge, re-rendering, exports, and the **5-post sample week** (§23).
- **Not counted when it fails:** a post that ends `Failed` (an error or a refusal, §11) is given back.
- Rewrites are unlimited in normal use; the workspace's AI cost ceiling (below) stops abuse.

### Running out, and limits

- At **80%** of posts, Owners and Admins get a warning; at **100%**, new generation stops (§15). Editing, approving
  and exporting keep working.
- **Extra posts:** **100 for $25**, or **৳2,500** in taka, bought by the Owner, available at once, used before the
  next monthly reset. Upgrading is offered beside it.
- **Brand, seat and storage limits** block adding more and suggest the next plan.
- **AI cost ceiling** (§22, internal, agencies see posts not dollars): set so a plan's posts fit at a pessimistic
  $0.20 each, plus 25%. That's **$20 / $75 / $250** for the dollar plans and **$15 / $50 / $125** for the taka plans.
  Extra packs raise it by the same rule. Hitting it pauses generation and alerts Zeus. **Global daily cap:** $100 a
  day during the partner phase.

### Changing plans, failed payments, cancelling

- **Upgrade:** at once, charged for the rest of the period (prorated); the new limits apply immediately.
- **Downgrade:** at the end of the period. If the workspace has more brands or seats than the smaller plan allows,
  the Owner removes some first.
- **Failed payment (Paddle):** Paddle retries and emails the customer; after the last failed try the workspace
  becomes **read-only** (the suspension of §15, with the reason "payment"), and the Owner is emailed. Paying unlocks it.
- **Taka invoices** are due in 7 days, with 7 more days of grace, then the same read-only state.
- **Cancel** any time: access lasts to the end of the period, then the workspace is read-only for 30 days (exports
  still work), then §16's deletion rules apply.
- **Refunds:** the first payment is refundable in full within 14 days; otherwise there are no partial refunds.

### Trial

Sign-up is invite-only at launch (§23), so **the free sample week is the trial**. A public trial comes with self-serve
sign-up, after the MVP.

### Design partners

- The 1–3 agencies Zeus picks (§23): **free for 3 months from their start date** with Agency limits (Zeus can raise
  them), then **50% off any plan for 12 months**, monthly or annual, in their own currency.
- In return: the weekly check-in, honest feedback, and a testimonial if they're happy (§23's partner agreement).
- No card is needed to start. Billing is set up in their third month.

### How money comes in

| Customers | Route | Currency | Tax and invoices |
|---|---|---|---|
| **Outside Bangladesh** | **Paddle**, with Zeus's Bangladeshi company as the seller | USD | Paddle is the **merchant of record**: it charges and files VAT and sales tax worldwide and issues the invoices (with the buyer's VAT number). The customer's statement shows Paddle |
| **Bangladesh** | A **local gateway** under Zeus's Bangladeshi company | BDT | LetZeusPost issues the invoice with Bangladeshi VAT; the accountant confirms the rate (15% standard; a 5% IT-services rate is mentioned in secondary sources only) and the invoice form |

**Paddle** (checked 2026-11-06): accepts Bangladeshi individuals and companies; **5% + 50¢** per payment; pays out
monthly by wire or Payoneer above $100. Before approving, it reviews the domain: **a live public website with
pricing, terms and a refund policy** (14 days or more).

**Taka payments at launch:** a **monthly invoice with a pay link** through a local gateway that takes cards, bKash and
Nagad (SSLCommerz is the candidate: ৳25,500 setup + 2.5%; its docs show no automatic recurring charges). **Automatic
monthly charges** through bKash's Recurring Payment come when bKash approves the account (fees unconfirmed). The
gateway is picked at build time after checking current fees and terms.

**Stripe later** (Zeus's first choice): only if a US company is set up, with Bangladesh Bank's permission to own it
(the March 2025 startup rule allows up to $10,000 for one company) and the money brought home as the law requires. An
accountant and a foreign-exchange lawyer advise first. Stripe can charge in taka, but Bangladeshi cards are capped at
$300 per foreign online payment, which is one more reason taka goes through a local gateway.

### For Zeus's accountant (to confirm before the first payment)

- Paddle payouts and local taka income arrive through a Bangladeshi bank, as the rules for IT exports require.
- IT-enabled services income is reported to be **tax-exempt until 30 June 2027** if a return is filed and the money
  comes through a bank, and software and IT-services exports get a **6% cash incentive** in FY26–27 (news reports).
- The VAT rate and invoice form for taka sales, and whether the company needs a VAT registration (BIN).

### In the product

- **Plans live in `config/plans.ts`** (sensitive, §13): both currencies, posts, brands, seats, storage, pack prices
  and AI ceilings. The admin panel can override any amount for one workspace (§15).
- **Billing sits behind the provider interface** (`config/providers.ts`): `manual` (the partner phase: nothing is
  charged, Zeus sets plans by hand), `paddle`, and the local gateway; `stripe` can be added later without touching the
  rest.
- **Webhooks** (`/api/webhooks/paddle`, `/api/webhooks/<gateway>`): the signature is checked, every event is handled
  once, and the workspace's plan and status follow the provider.
- Usage counters reset monthly on the billing day (§13's `usage_counter`).
- **Settings › Plan & usage** shows the plan, the meters, the plans table in the workspace's currency, extra packs,
  invoices, and Paddle's customer portal for the card and cancelling.

### Costs and margin (to check after the first 100 real posts, §09)

AI at about $0.10–0.15 per post (§09's estimate), if every post in the plan is used:

| Plan | Price in USD | AI at full use | AI share |
|---|---|---|---|
| Starter | $49 | $8–12 | 16–24% |
| Agency | $129 | $30–45 | 23–35% |
| Scale | $299 | $100–150 | 33–50% |
| Starter (taka) | ≈ $23 | $6–9 | 26–39% |
| Agency (taka) | ≈ $64 | $20–30 | 31–47% |
| Scale (taka) | ≈ $144 | $50–75 | 35–52% |

Add Paddle's or the gateway's fee (about 3–7%) and the servers (§14). Most agencies won't use every post. If the
measured cost is higher, the first levers are moving some tasks to a cheaper model in `config/models.ts` (§09) and
adjusting the post amounts.

### Changes to other sections (on approval)

- **§01:** a **one-page public website** (what LetZeusPost is, pricing, terms, privacy, refunds) is needed for
  Paddle's review before the first payment. The full marketing site stays out of the MVP.
- **§03:** the domain must be bought before that page goes up. **§16:** the terms, refund policy and privacy text it links to.
- **§22:** the cap amounts above.

## Not in the MVP

Stripe · a public trial · per-seat add-ons (more seats come with the next plan) · usage-based billing · coupons beyond
the design-partner discount · invoices paid by bank transfer abroad · other currencies.

## Done when

- `config/plans.ts` holds both price lists, and every limit in this section is enforced with a test (posts, packs,
  brands, seats, storage, AI ceiling, the global cap).
- Counting: a linked pair counts 2, a regeneration 1, a failed post 0, the sample week 0.
- Paddle (sandbox): subscribe, upgrade with proration, downgrade at period end, a failed payment → read-only → paid →
  unlocked, cancel → read-only for 30 days, a refund within 14 days.
- A taka invoice with a pay link is paid through the gateway's sandbox, and an unpaid one locks the workspace after
  the grace period.
- Every webhook is signature-checked and safe to receive twice.
- A design partner's 3 free months and the following 12 months at 50% work without manual steps.

## Depends on

[01](01-product-spec.md), [09](09-ai-pipeline.md) (cost per post), [13](13-architecture.md), [15](15-accounts-and-admin.md),
[22](22-product-ai-guardrails.md), [23](23-onboarding.md). Feeds §03 (domain), §14 (costs), §16 (terms, refunds),
§18 (when billing must be ready: three months after the first partner starts).
