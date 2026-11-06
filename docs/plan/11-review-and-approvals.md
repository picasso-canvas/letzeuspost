# Section 11: Review, editing and approvals (Approved 2026-11-06)

**Goal:** how posts are edited, who approves them and when, how the client reviews them, how comments and
notifications work, and what gets recorded, so nothing wrong reaches a client or goes out by accident.

## Questions for Zeus

| Question | Answer |
|---|---|
| Approval modes? | Set per brand: **none / agency / agency then client** (interview, 2026-11-06) |
| Who approves for the agency? | Owner, Admin, Editor; Viewers only comment (§01) |
| An approved post is edited? | **Typo fixes keep the approval; anything bigger is re-approved** (2026-11-06) |
| What does a review link cover? | **One link per batch**, expiring 30 days after the last send (2026-11-06) |
| The client doesn't answer? | **Never auto-approve**; the agency is alerted and decides (2026-11-06) |
| Several client reviewers? | **Any one of them** can approve; everyone sees who did (2026-11-06) |

## Spec

### Post statuses

`Generating` → `Needs a fix` (fit or QC failed) → `In review` → `With client` → `Changes requested` → `Approved` →
`Exported`, plus `Failed` (with a plain reason).

| Brand's mode | Path |
|---|---|
| **None** | QC passes → `Approved` |
| **Agency** | QC passes → `In review` → an editor approves → `Approved` |
| **Agency then client** | QC passes → `In review` → an editor sends it → `With client` → the client approves → `Approved`, or asks for changes → `Changes requested` → the editor edits and resends → `With client` |

**Gates before a post can be sent or approved:** QC passed (warnings acknowledged by the editor; failures can't be
sent; principle 7) · health, money and legal claims confirmed (§22) · testimonial consent ticked (§07) · consent for
recognisable people (§10).

### Editing

- Every change autosaves. Edits within 60 seconds are grouped into one **version** (who, when, which fields changed).
  History keeps every version; restoring one creates a new version. Undo and redo work within the session.
- The preview updates instantly in the browser; the final images are re-rendered in the background about 2 seconds
  after editing stops, and cached by content.
- **AI rewrite** (§09) makes a version labelled "AI rewrite: ‹instruction›". **Regenerate with a note** makes a new
  version and counts as a new post (§01).
- **Linked EN + BN posts:** editing one shows "The ‹other language› version may need the same change", with
  "Update the other version" (an AI rewrite, written natively in that language, never translated, shown for
  confirmation).
- **Two people on one post:** the second sees "Nadia is editing" and can view, or take over (which saves Nadia's
  work first). No silent overwrites.

### Editing after approval (Zeus: typos keep it)

A **small fix** is: text-only changes of at most **10 characters per slide**, with **no change** to numbers, prices,
dates, times, links, names, hashtags, sources, images, layout or networks. A small fix keeps the approval, is logged
("Typo fixed after approval · Nadia"), and doesn't ping the client.

Anything bigger sends the post back to whoever approved it: `In review` in agency mode, `With client` in client mode.
The reviewer sees **"Changed after your approval"** with the difference highlighted.

### The client's review link (one per batch)

- **Sending:** the editor selects QC-passed posts → **Send to client** → picks reviewers from the brand's list (or adds
  one: name + email) → adds a note → sends. Posts from the same batch sent later join the same link.
- **The link:** an unguessable token (at least 128 bits), **stored hashed**, expiring 30 days after the last send; the
  agency can revoke or replace it. The page isn't indexed by search engines, sends no referrer, and is rate-limited
  (our `review-links` skill, §20).
- **The page** shows only the posts sent, by date: slides to swipe, the caption for each network, date and time.
  Actions: approve · request changes (a comment is required) · comment on a slide · approve all remaining · add photos (§10).
- **Who's reviewing:** the first visit asks for a name and email (filled in from the invite). Any of the brand's listed
  reviewers can act, and **the first approval counts**; the others see "Approved by Rafiq Ahmed".
- **Changes requested:** after the editor's changes and a resend, the client sees the changed posts first, with what changed highlighted.

### When the client doesn't answer (never auto-approve)

- One reminder email after 2 days (the agency can turn it off).
- 48 hours before a post's date: "Still waiting for the client" to the batch owner, in the app and by email.
- An agency Owner or Admin (§15) may **mark a post approved on the client's behalf** with a reason ("approved by phone"); it's recorded
  as exactly that, never as the client's own approval.

### Comments

On a post or on a slide (by number), from the team and the client. @mentions for team members. Comments can be
resolved; a post shows its count of open comments; client comments land in the Inbox under "Client feedback".
Comments pinned to a spot on a slide wait for after launch (§04).

### Notifications

In the app (bell) and by email, each person choosing per type: instantly, a daily digest, or off.

| Event | Who | Default |
|---|---|---|
| Batch ready (all posts generated) | the batch owner | app, + email if they left |
| Post needs a fix | the batch owner | app |
| Client approved, asked for changes or commented | the batch owner + anyone mentioned | app + email |
| @mention | that person | app + email |
| Due in 48 h and not approved | the batch owner | app + email |
| Client sent photos (§10) | the batch owner | app |
| Large export ready (§12) | whoever asked | app |

**Client emails:** the first review email and the one reminder (§23), and "Changes made, please take another look" on
a resend. They are sent in the agency's name, and **replies go to the batch owner's email**, so a client answering by
email reaches a person. Onboarding emails are in [§23](23-onboarding.md).

### What gets recorded

Every status change, approval, approval on the client's behalf, link sent, revoked or replaced, and edit after approval
is recorded (who, when, from which account or link) and shown in the post's History. Exports can include an
"approved by / when" column (§12).

## Not in the MVP

Comments pinned to a spot on a slide · client accounts · auto-approval · a rule that someone other than the writer must
approve (later, per brand) · a review page on the agency's own domain · Slack, WhatsApp or push notifications.

## Done when

- All three approval modes work end to end, including changes requested and resend.
- The small-fix rule passes a test set (a typo keeps the approval; a changed price, date, image or hashtag re-approves).
- Review links: tokens hashed, expiry, revoke and replace, rate limits and noindex all tested.
- Several reviewers: the first approval counts and the others see who approved; approvals on behalf are labelled.
- Notification settings are honoured, and client email replies reach the batch owner.

## Depends on

[01](01-product-spec.md), [04](04-flows-and-screens.md), [07](07-posts.md), [10](10-images.md), §15 (roles),
[20](20-builder-guardrails.md) (`review-links` skill), [22](22-product-ai-guardrails.md), [23](23-onboarding.md).
