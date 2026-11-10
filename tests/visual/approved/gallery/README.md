# Gallery baselines

The approved screenshots for `tests/gallery/gallery.visual.spec.ts`, one per story and theme, at the path
`playwright.config.ts`'s `snapshotPathTemplate` gives. Only Athena changes them, after Iris and Zeus approve the new
pictures (§21 Visual tests, Q11); builders never write this folder.

| Set | Rendered by | Approved | Record |
|---|---|---|---|
| First 38 (19 stories × light, dark) | CI's `design` job, run 42570186043, PR #120 at `bf287ee` | Zeus, 2026-11-09, after Iris's three checks | #127 (with the SHA-256 of each file), #74 |

Changing one is a `sensitive` change: show the before, the after and the diff, and record who approved it.
