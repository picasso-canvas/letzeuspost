# Section 9: AI pipeline (Draft, waiting for Zeus)

> **Stack details pending §13.** File paths (`config/models.ts`, `packages/ai/…`) are assumptions collected in
> [13-architecture.md](13-architecture.md). Claude API facts were checked against Anthropic's current docs on 2026-11-06.

**Goal:** every AI task in LetZeusPost (what goes in, what comes out, which model, how it's checked and what it
costs), so posts come out on-brand, in native English and Bangla, safely and at a known cost.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Which model to start with? | **Claude Opus 5.5 for every task**; switchable per task in `config/models.ts`. Cheaper models only after measuring |
| Web search for facts? | **Yes, for fact, stat and photo-card posts only**, every fact with its source link. Claims about the client still come only from the kit's Facts |
| Learn from the agency's edits? | **Per brand, from approved posts**; never shared across brands or agencies; no model training |
| Who judges native Bangla? | **An AI judge on every Bangla post + Zeus reads 10 Bangla posts a week**; his verdicts tune the judge |

## Spec

### The tasks

| Task | Does | Reads | Returns | Effort | Tools |
|---|---|---|---|---|---|
| `extractSource` | Reads a website, an uploaded document or a J3 link | page or file text, **as untrusted data** (§22) | facts and voice signals, each with its source | low | none |
| `brandProfile` | Drafts a brand kit | extracted facts, post screenshots and logo (vision), the 8 answers | voice, facts, pillars, palette and font suggestions, each marked found / guessed | medium | none |
| `planBatch` | Plans a week or a month | kit, period, posts per week, networks, languages, holidays, the brand's recent posts (to avoid repeats), notes | ideas: date, kind, layout, pillar, hook, networks, language(s) | medium | none |
| `writePost` | Writes one post in one language | the idea, kit, layout fields (§07), network rules (§07), the brand's examples and edit lessons | post content: slides, a caption per network, alt text, sources, an image request per slide | **high** | web search, **only** for fact, stat and photo-card layouts |
| `pickImages` | Chooses library photos | the image requests, the brand's assets (descriptions and tags) | asset per slide with crop and focus, or "type only" | low | none |
| `fitFix` | Shortens text that doesn't fit | the slide, the fit report | shorter words, same meaning and language | low | none |
| `rewrite` | Applies an editor's instruction ("shorter", "warmer") | the slide or post, the instruction | the revised content; facts and sources unchanged unless asked | low | none |
| `qc` | Checks a finished post | content, the rendered slides (vision), kit rules, the content policy (§22) | pass / warn / fail with notes per check | medium | none |
| `banglaJudge` | Scores Bangla posts | the Bangla text, rubric | scores 1–5 + notes | medium | none |
| `tagAsset` | Describes an upload | the image (vision) | description, tags, people present, text present | low | none |
| `learnLessons` | Turns edits into brand lessons | the week's approved posts and editor changes | up to 10 short lessons for the brand | low | none |

All tasks return **structured output** (`output_config.format`) checked against a zod schema; a schema failure is
retried once, then the post fails with a plain reason.

### Model and provider config (sensitive files)

```ts
// config/models.ts: one line per task; switching a task's model is a one-line change
export const models = {
  extractSource: { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
  brandProfile:  { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" },
  planBatch:     { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" },
  writePost:     { provider: "anthropic", model: "claude-opus-5-5", effort: "high", webSearch: "fact-layouts" },
  pickImages:    { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
  fitFix:        { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
  rewrite:       { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
  qc:            { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" },
  banglaJudge:   { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" },
  tagAsset:      { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
  learnLessons:  { provider: "anthropic", model: "claude-opus-5-5", effort: "low" },
} as const;

// USD per million tokens, checked 2026-11-06 (Anthropic pricing)
export const prices = { "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 } };
```

- `config/providers.ts` names the provider for each kind of work (text: Anthropic; image generation: after launch).
  The code talks to a provider interface, so another provider can be added later without touching the pipeline.
- Opus 5.5 specifics: thinking can't be turned off, so **effort is set explicitly on every task**; forced tool choice
  isn't allowed, so tasks use structured outputs; **server-side refusal fallbacks are on** (`fallbacks: "default"`).
- Model IDs are exactly as Anthropic publishes them (`claude-opus-5-5`), never guessed or date-suffixed.

### How a batch runs

1. `planBatch` → the editor keeps, edits or drops ideas (§04).
2. For each idea, in parallel (**at most 4 posts at a time per workspace**, one queue for everyone):
   `writePost` → `pickImages` → render (§08) → fit check → `fitFix` (at most 2 tries) → `qc` (+ `banglaJudge` for
   Bangla) → **Ready**, or **Needs a fix** with the reason.
3. **Linked EN + BN posts:** both are written from the same idea and facts, **each written natively in its own
   language, never translated from the other**, then shown side by side in the editor.
4. Temporary API errors are retried with backoff. A refusal goes to the fallback model; if that refuses too, the post
   is marked failed with a plain reason (§22).

### How prompts are built

- Order (so the cache works): tools → product rules (the same for everyone) → the brand block (kit version + lessons)
  → the task → untrusted inputs, each wrapped and labelled as data → the request. The stable part is byte-identical
  between calls (no timestamps or IDs in it), so most of each prompt is a **cache read at about 5% of the price**.
- Prompts live in `packages/ai/prompts/<task>.md` with a version number. Every AI call records the prompt version it
  used. Changing a prompt is a `sensitive` change and must pass the evals (§22).
- The writing rules come from the studio: native Bangladeshi Bangla, facts need sources, shorten instead of shrink,
  original only (from the studio's `scriptwriting` and `social-posts` skills).

### Native Bangla

- Standard Bangladeshi Bangla, written for the brand's audience; the kit sets the form of address (আপনি or তুমি).
- Bangla digits in Bangla text; brand and product names keep their own spelling; no English words dropped in where a
  common Bangla word exists, unless the brand's examples do it.
- `banglaJudge` scores naturalness, spelling and grammar, register, cultural fit and clarity (1–5 each). Below 4 on
  any of them → a warning and one automatic rewrite; still below → the editor sees the notes.
- **Every week Zeus reads 10 Bangla posts** in his admin panel (a mix of random and low-scored ones) and marks each
  good / needs work, with a note. His verdicts become the judge's test set; when Zeus and the judge disagree on more
  than 2 in 10, the judge's prompt is tuned.

### Web search (fact, stat and photo-card posts only)

- The web search tool, at most 5 searches per post. Every fact on a slide gets a source URL in `sources`; `qc` fails a
  fact without one.
- Claims about the client never come from the web: only from the kit's Facts (§06).

### Learning per brand

- Approved posts (their final versions) become the brand's examples; `writePost` sees the 5 most recent approved posts
  of the same layout.
- Each week `learnLessons` turns what editors changed into up to 10 short lessons (e.g. "Editors shorten headlines to
  5 words", "Use আপনি, not তুমি"). They show in the brand kit's Voice tab, where the agency can edit or delete them.
- Never shared across brands or workspaces; never used to train any model. Deleting a brand deletes its examples and lessons.

### Cost

- Every call writes an `ai_usage` row: task, model, prompt version, input / output / cached tokens, cost in USD (from
  the price table), workspace, brand, post.
- **Estimate: about $0.10–0.15 per post** (write + QC + one fit fix, with caching), to be measured on the first 100
  real posts. Caps per workspace and per day are in §22; their amounts in §02.

### Measuring quality

Shown per brand, layout and language in Zeus's admin panel (§15): approved without edits (target 70%, §01), edits per
post, how often `fitFix` runs, QC warn and fail rates, Bangla judge scores and Zeus's weekly verdicts, refusals, cost
and time per post.

### Development and tests

- Builders never call the live API (§20): a **mock provider** replays recorded responses.
- The eval suite (§22, plus a quality set of 20 briefs × 3 sample brands × EN/BN) runs on every prompt or model change
  and weekly, through the Batches API at half price.

## Not in the MVP

Other AI providers (the interface is ready; only Anthropic is built) · AI image generation (after launch) · fine-tuning ·
learning across brands · prompts editable by agencies.

## Done when

- Every task has its prompt, schema, and eval cases (including the §22 policy and injection cases).
- A 12-post EN + BN batch runs from plan to Ready end to end, with every call's cost recorded.
- The `writePost` cache hit rate is above 70% after the first post of a batch.
- The refusal and schema-failure paths are tested.
- Zeus's first weekly Bangla review is done in the admin panel.

## Depends on

[06](06-brand-kits.md), [07](07-posts.md), [22](22-product-ai-guardrails.md), [13](13-architecture.md) (stack), §02 (cap
amounts), §15 (admin panel).
