# Section 22: Product AI guardrails (Approved 2026-11-06, revised 2026-11-06)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** LetZeusPost's own AI stays safe, on-brand and affordable, even when fed hostile input.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| What should the AI refuse or flag? | Political/election content · health, money and legal claims · restricted industries · real people in AI images |
| Cost limits? | A monthly cap per workspace and a global daily cap |
| Who may change prompts and AI rules? | Zeus merges every PR; prompt and AI-rule changes are `sensitive`, and the evals must pass |

## Spec

### Threats

Prompt injection from untrusted text (client websites, J3 links, uploaded files, stock metadata, client comments) ·
harmful or off-brand output · unsupported claims · likeness and IP problems · data leaking between workspaces · runaway cost.

### Controls

1. **Untrusted input is data, never instructions.** Fetched pages pass through an **extraction step** (no tools,
   strict schema) that returns structured facts. The writing step sees only those facts, wrapped and labelled as
   untrusted, never the raw page. Fetches are SSRF-guarded (our `safe-fetch` skill), size-limited and stripped to text.
2. **No acting tools.** The product AI only returns structured JSON validated by zod. It can't send, publish, write
   to the database or call other services. The only tool is web search, used for fact posts.
3. **Deterministic output checks:** schema, length and character limits (Bangla counted correctly), banned words
   from the brand kit, links limited to the brand's domain and recorded sources, hashtag rules, and no personal data
   (emails, phone numbers) that isn't in the kit.
4. **Content policy (Zeus, 2026-11-06):**
   - **Political / election:** election and campaign content is refused; political topics are flagged for a human.
   - **Health, money, legal claims:** need a source and get flagged. An editor must tick "confirmed" before the post
     can go to the client.
   - **Restricted industries** (alcohol, gambling, tobacco/vape, adult): allowed only when the brand kit marks the
     industry, with each network's rules applied; refused otherwise.
   - **Real people:** AI images never show a real person's likeness, a celebrity or a public figure. Named people are
     stripped from image prompts, and photos of real people come only from the brand's library with a consent tick.
   - **No ID documents or sensitive personal data** in uploads (§16); national ID, passport, tax-ID or biometric
     data is never asked for.
5. **The QC task** checks each post against the policy and the brand rules (pass / warn / fail). Generated images get
   a vision check and carry the synthetic flag through to export.
6. **Model refusals:** server-side fallbacks are on. A final refusal marks the post failed with a plain reason.
7. **Isolation:** every AI call is scoped to one workspace and brand. No other brand's data enters a prompt, and
   cache keys include the workspace. (Cloudflare's guidance: "a guardrail prompt is not a security boundary.")
8. **Cost caps:** each workspace has a monthly AI cost ceiling tied to its plan ($20 / $75 / $250, taka plans $15 / $50 /
   $125, [§02](02-pricing-and-billing.md)), with a warning at
   80% and generation paused at 100% ("contact us"; Zeus can raise it). Limits on max tokens per call, posts per
   batch and concurrent jobs per workspace; retries are bounded (fit fix ≤ 2, regenerations rate-limited). A
   **global daily cap** ($100 a day in the partner phase, §02) pauses all generation and alerts Zeus. (Our `ai-cost-caps` skill; nothing outside covers this.)
9. **Audit:** every AI call (`ai_usage`) and every policy event (`policy_events`: flag, refusal, cap hit) is logged
   and shown in Zeus's admin panel (§15).

### Evals (the gate for prompt changes)

`packages/ai/evals/`: cases for each policy rule, injection attacks (a website or link page saying "ignore your
instructions…", a malicious client comment), brand-rule breaks, sourced facts, native Bangla quality (graded with a
rubric), and fit. They run in CI on every PR that touches the AI prompts or policy (a `sensitive` area) and weekly on `main`.
Thresholds must pass, and the results go into the weekly report. Built with the `claude-api` skill's `build-eval` and
the evals-skills method (error analysis on real traces, checked judges).

## Not in the MVP

A separate moderation model or service; customer-editable content policies; promptfoo red-team runs (reference for later).

## Done when

- Every policy rule and injection case has at least one passing eval.
- In the injection suite, a hostile website can't change a post's topic or links.
- The caps pause generation in a test with tiny limits.

## Depends on

§09 (AI tasks), §02 (cap amounts), §15 (admin panel), §16 (policy wording for customers).
