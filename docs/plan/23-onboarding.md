# Section 23: Onboarding (Approved 2026-11-06)

**Goal:** everyone who meets LetZeusPost gets to their first useful result fast: the agency owner, a team member who
joins, the agency's client, and the design-partner agencies that Zeus onboards in person.

Added 2026-11-06 when Zeus asked "Do we have onboardings?". It gathers onboarding from §04 (screens), §11 (emails)
and §18 (the partner launch) in one place. Mockups: https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe (screens
"Welcome", "Team member joining", "Inbox" with the checklist, "Onboarding emails").

## Questions for Zeus

| Question | Answer |
|---|---|
| Which onboarding pieces to plan now? | All four: the getting-started checklist, team members joining, onboarding emails, the design-partner playbook (2026-11-06) |
| Where do partners talk to you day to day? | **Email only**, plus the in-app Report a problem button |
| Does the welcome email come from Zeus personally? | **Yes**, signed by Zeus; replies go to him |
| Email language? | **English** for now, like the app; Bangla emails later |

## Spec

### 1. Agency first run (already in §04)

Invite code → sign in → workspace name and role → the first client's **website, or their files (logo + 3–10 recent posts), or 8 quick answers** (§06; brands without a website are fine) → check the kit and pick a look →
choose networks and languages → **a free sample week of 5 posts**. Target: the sample week is generating within
**10 minutes** of sign-up.

### 2. Getting-started checklist (new)

A "Get set up" card at the top of the Inbox for owners and admins, after the first run:

| Step | Done when | Start button goes to |
|---|---|---|
| Make your sample week | the sample batch exists | (done in the first run) |
| Add your first brand | a brand exists | (done in the first run) |
| Invite your team | one invite is sent | the invite dialog |
| Choose how ‹brand› approves posts | the approval mode was set on purpose | Brand kit › Publishing |
| Send your first client link | a review link was sent (sending it to yourself counts) | the batch, Send to client |
| Plan your first real month | a non-sample batch was generated | New calendar |

Steps tick themselves. The card shows "n of 6 done", can be hidden (it comes back from the help menu), and disappears
when everything is done. Members get a shorter version: set your name and photo, turn on email notifications, open your
first post.

### 3. A team member joining (new)

1. **Invite** (Settings › Members or the checklist): email + role (Admin, Editor, Viewer; §15). It works once, is tied
   to that email address, and expires after **7 days**. It uses a seat.
2. **Invite email** "‹Inviter› invited you to ‹Agency›", with the role explained in one line.
3. **Accept screen:** the agency, who invited them, the role; **Continue with Google** or **Email me a sign-in link**,
   either way with the invited address. An expired or used invite says "Ask ‹inviter› for a new invite".
4. **First visit:** three cards (your brands · what's waiting for you · how approval works here), then the Inbox filtered
   to their batches. Viewers see a one-line note that they can look and comment only.

### 4. The agency's client (already in §04 and §11)

The first review email in the agency's name, the name prompt on the first visit to the review page, and one reminder
after 2 days (the agency can turn it off). No account, no app to learn.

### 5. Onboarding emails

Sent through the email provider (§14). Transactional only, no marketing. Short, plain, with one button and a
plain-text version.

| Email | To | When | Notes |
|---|---|---|---|
| Welcome | new agency owner | right after sign-up | signed by Zeus; replies go to him |
| Sample week ready | owner | when the sample week finishes, **only if they left the page** | 3 thumbnails |
| Finish-setup reminder | owner | 2 days after sign-up if the sample week isn't reviewed | at most 2 reminders, then stop; can be switched off |
| Team invite | invited member | on invite | role in one line, expiry date |
| Client: first review | the client | the first time posts are sent to them | in the agency's name; "you don't need an account" |
| Client reminder | the client | once, 2 days later, if posts are still waiting | agency can turn it off |

The other emails (batch ready, comments, mentions, due soon) are planned in §11.

### 6. Design-partner playbook (Zeus + Athena)

| When | What |
|---|---|
| **Before** | Zeus picks the 1–3 agencies and sends a personal note. A short partner agreement: free until the date in §02, a weekly check-in, honest feedback, data stays theirs (§16). Zeus creates an invite code in the admin panel (§15) |
| **Kickoff, week 0** (45 min, screen share) | Their goals and how they make posts today (to measure "time saved" against); pick 1–2 real client brands; do the first run together; invite their team; confirm their scheduler (Metricool) and how approvals work with their clients; agree the success measures from §01 |
| **Week 1** | First real calendar together. Athena watches generation and QC for their posts and keeps a fix list |
| **Weekly** (20 min) | Look at their numbers (time to export, edit rate, weekly use), their top 3 problems, what changed since last week. Fixes land within a week or get an honest "not yet, because…" |
| **Every day** | **Email** with Zeus, and an in-app **Report a problem** button that sends Zeus the screen, the post and a note |
| **End of the free period** | Review the success measures together, offer a plan (§02), and ask for a testimonial (with consent) |

### 7. Measuring onboarding

The app records each step: invite accepted → brand created → sample week generated → sample reviewed → team member
invited → approval mode set → first client link sent → first real batch exported. Zeus's admin panel (§15) shows where
each workspace is and where people stop.

## Not in the MVP

Product tours and tooltips · an in-app "what's new" · Bangla interface and emails · self-serve sign-up without an
invite code · onboarding for individual brands (only if the Brand plan happens).

## Done when

- The checklist, the invite flow (accept, expired, first visit) and all six emails are in the approved mockups.
- In a test, a new agency reaches a generating sample week within 10 minutes, and an invited member reaches their
  Inbox in under 2 minutes.
- The playbook has been used with the first design partner, and every onboarding step is recorded.

## Depends on

[01](01-product-spec.md), [04](04-flows-and-screens.md), [05](05-app-design.md); feeds §11 (emails), §15 (invites, admin
panel, seats) and §18 (the partner launch).
