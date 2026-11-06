# Section 15: Accounts, team and owner admin (Approved 2026-11-06)

**Goal:** workspaces and the people in them, who can do what (the permission matrix), invites and seats, usage
meters, each person's account, and Zeus's admin panel.

Mockups (version 9): https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe (screens "Settings: members and seats",
"Zeus's admin panel", and the workspace switcher in the top bar).

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| One person in several workspaces? | **Yes, with a workspace switcher** |
| Limit a member to certain brands? | **All brands at launch**; the checks are built so brand limits can be added later |
| How much can Zeus see inside a workspace? | **Read-only, logged**: never edit or act as the agency; every view is logged and the agency sees the log |
| Who counts as a seat? | Owner, Admins and Editors; **Viewers are free**; client reviewers never (no account) |
| Who may approve on the client's behalf? | **Owners and Admins** |
| Admin panel extras at launch? | **All four**: suspend a workspace, a banner to all users, download a workspace's data, feature switches per workspace |
| Extra protection for Zeus's admin access? | **A passkey on top of Google sign-in**, asked again every 12 hours |

## Spec

### Workspaces

- One workspace = one agency, created with an invite code from Zeus (§23). It has a name, a logo, the name shown on
  review pages, a default timezone, a plan and **exactly one Owner**.
- **One person, several workspaces:** a switcher in the top bar lists the workspaces a person belongs to, with their
  role in each; the last one used opens first. Nothing crosses between them: brands, posts, notifications and seats
  stay in their own workspace (§13), and emails name the workspace they come from.
- **Ownership** moves only when the Owner hands it to an Admin, who accepts; the old Owner becomes an Admin.
- **Leaving:** anyone except the Owner can leave a workspace (the Owner hands over ownership first).
- **Deleting a workspace:** the Owner only, after typing the workspace's name. Every member is emailed, review links
  stop at once, and the data is kept for the grace period set in §16 before it's gone for good.
- **Suspended by Zeus** (for example after a payment problem or abuse): the workspace becomes read-only, exports still
  work, generation stops, and clients' review pages say "This review is paused. Contact ‹agency›". A banner tells the
  agency why and how to reach Zeus.

### Who can do what

The roles are from §01. ✓ = allowed. Every cell is a test (below).

| | Owner | Admin | Editor | Viewer | Client reviewer (link) |
|---|---|---|---|---|---|
| **Workspace** | | | | | |
| See everything in the workspace (all brands) | ✓ | ✓ | ✓ | ✓ | only the posts sent to them |
| Workspace settings (name, logo, review-page name, timezone) | ✓ | ✓ | | | |
| Invite and manage Editors and Viewers | ✓ | ✓ | | | |
| Invite and manage Admins | ✓ | | | | |
| Plan, billing and invoices | ✓ | | | | |
| Hand over ownership, delete the workspace | ✓ | | | | |
| See the usage meters | ✓ | ✓ | ✓ | ✓ | |
| See Zeus's support-access log | ✓ | ✓ | | | |
| **Brands** | | | | | |
| Create a brand, edit its kit, manage its asset library | ✓ | ✓ | ✓ | | |
| Approve photos the client sent (§10) | ✓ | ✓ | ✓ | | |
| Set the approval mode | ✓ | ✓ | | | |
| Edit the brand's client reviewers | ✓ | ✓ | ✓ | | |
| Delete a brand | ✓ | ✓ | | | |
| **Posts** | | | | | |
| Make batches, generate, edit, AI rewrite, regenerate | ✓ | ✓ | ✓ | | |
| Confirm claims and tick consent (§22, §07, §10) | ✓ | ✓ | ✓ | | |
| Approve for the agency | ✓ | ✓ | ✓ | | |
| Send to the client; revoke or replace a review link | ✓ | ✓ | ✓ | | |
| **Approve on the client's behalf** (with a reason) | ✓ | ✓ | | | |
| Comment | ✓ | ✓ | ✓ | ✓ | ✓ (on sent posts) |
| Approve or request changes as the client | | | | | ✓ |
| Send photos (§10) | | | | | ✓ |
| Export | ✓ | ✓ | ✓ | | |

- **Brand limits later:** every check takes the brand as well as the workspace, and today answers "all brands". Adding
  limits later changes the answer, not every call.
- The matrix lives in one file (`packages/core/permissions`, sensitive, §13).

### Invites and seats

- Invites as in §23: Owners and Admins send them (Admins for Editors and Viewers only); one use, tied to the email
  address, 7 days; they can be resent or revoked.
- **Seats used = Owner + Admins + Editors + their pending invites.** Viewers and their invites are free.
- **At the limit,** the invite dialog says "All 5 seats are used. Invite them as a Viewer (free), remove someone, or
  contact us". During the design-partner phase Zeus raises limits by hand (§02 sets the amounts).
- Making a Viewer an Editor or Admin needs a free seat.
- **Removing a member** first asks who takes over the batches they own, so client email replies (§11) and
  notifications still reach a person. Their posts, comments and approvals stay, under their name.

### Each person's account

- Name, photo and email (from Google or the sign-in link; changing the email needs the new address confirmed),
  notification settings (§11) and their own timezone (times are shown in the brand's timezone, with theirs on hover, §12).
- **Signed-in devices** with "Sign out everywhere". Sessions last 30 days and renew while in use.
- **Deleting your account** is possible unless you're the only Owner of a workspace (hand it over first). What you
  made stays in the workspace, shown as "Former member".

### Usage meters

What's metered (the amounts are §02's): posts this period, brands, seats and storage. AI cost is tracked per workspace
(§09, §22) but agencies see posts, not dollars.

- The sidebar shows posts used this period; **Settings › Plan & usage** shows every meter, a per-brand breakdown and
  past months.
- At **80%** a warning goes to Owners and Admins; at **100%**, new generation stops with "Contact us" (Zeus raises it
  during the partner phase; buying more comes with §02). Editing, approving and exporting keep working.
- The free sample week (§23) isn't counted.

### Zeus's admin panel (`/admin`)

**Access:** Zeus's account (the platform-admin flag) **plus a passkey** (Touch ID on the Mac or the phone), asked
again every 12 hours. It has its own frame outside any workspace, reads through its own database role (§13), and logs
everything it opens.

| Part | What's there | Comes from |
|---|---|---|
| **Workspaces** | Each agency: plan, seats, brands, posts and AI cost this month, setup steps done, last active, what needs a look (failures, problem reports, a stalled setup) | §01, §23 |
| **A workspace** | Its numbers and members; **view its posts and kits read-only** (a "Viewing as support" bar, logged, shown to the agency); raise limits; **feature switches**; **download its data**; **suspend** (with a reason) | this section |
| **Invite codes** | Create a one-use code for a named agency (valid 14 days); see which were used | §23 |
| **Quality** | Approved without edits, edits per post, `fitFix` rate, QC results, refusals, cost and time per post, by brand, layout and language | §09 |
| **Bangla reads** | The weekly 10 Bangla posts (random and low-scoring), marked good or needs work with a note | §09 |
| **AI cost** | Per workspace, task and model; the global daily cap and each workspace's ceiling | §22 |
| **Policy events** | Flags, refusals and cap hits | §22 |
| **Problem reports** | Reports from the app's button, with the screen, the post and the note; open or answered | §23 |
| **Success measures** | Per design partner: paying, time to a month of posts, edit rate, weekly use | §01 |
| **Banner** | A short message to every user, with start and end times and a preview | this section |
| **Audit log** | Everything Zeus opened or changed in the admin panel | this section |

- **Support access, never impersonation:** Zeus can look, never edit or act as a member. If an agency wants hands-on
  help, they invite Zeus as a Viewer (free), like anyone else. The agency sees every support view in **Settings ›
  Members › LetZeusPost support access**, and the terms say so (§16). The weekly Bangla reads appear there too.
- **Feature switches:** a named list of features in `config/features.ts`, each on or off per workspace (a feature can
  go to one partner first). New features start off.
- **Download a workspace's data:** a ZIP with every brand, kit, post and version, comment, approval and file, made in
  the background; the link works for 7 days. Agencies ask Zeus by email for now; a button for Owners can come later.

## Not in the MVP

Limiting members to certain brands (built to be added) · custom roles · single sign-on · Zeus acting as a member ·
several Owners · teams or groups · agencies downloading their own data from a button · agencies exporting the support log.

## Done when

- The matrix is one table in code with a test for every cell, allowed and refused, including the client reviewer.
- The workspace switcher never shows another workspace's data (the §13 tenancy suite covers switching).
- Seats: Viewers free, pending invites counted, the at-limit message, and Viewer → Editor blocked without a free seat.
- Removing a member hands their batches to the chosen person, and client replies then reach that person.
- Suspension: read-only, exports work, generation stopped, review links show the paused page.
- The admin panel asks for the passkey every 12 hours; every support view is logged and listed for that agency; the
  data download contains one workspace's data and nothing else.

## Depends on

[01](01-product-spec.md), [04](04-flows-and-screens.md), [09](09-ai-pipeline.md), [11](11-review-and-approvals.md),
[13](13-architecture.md), [22](22-product-ai-guardrails.md), [23](23-onboarding.md). Feeds §02 (seats, meters),
§16 (support access in the terms, data download, how long deleted data is kept) and §18.
