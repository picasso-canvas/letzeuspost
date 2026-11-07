import { createHash } from 'node:crypto';
import type { ReviewRecord } from './types.ts';

/**
 * What a PR changes on its own: every changed path with its old and new mode and blob, against the PR's merge-base
 * with main. Merging main in leaves it unchanged unless main touched one of the PR's files (then its old blob moves)
 * or the merge changed the PR's result. Equal ids mean the reviewers saw exactly this change.
 */
export function changeId(git: (args: string[]) => string, sha: string): string {
  const base = git(['merge-base', 'origin/main', sha]).trim();
  const raw = git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, sha]);
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * The records the gate judges at `head` (Zeus, 2026-11-07: reviews survive an update from main). A reviewer with any
 * record at the head is judged on those alone. Otherwise its records come from the newest earlier head (`earlier`,
 * newest first, each with the same change id as the head), blocks included, marked with where they came from.
 */
export function selectReviews(
  head: string,
  current: readonly ReviewRecord[],
  earlier: readonly { sha: string; records: readonly ReviewRecord[] }[],
): ReviewRecord[] {
  const selected = [...current];
  const covered = new Set(current.map((r) => r.reviewer));
  for (const { sha, records } of earlier) {
    const found = new Set<ReviewRecord['reviewer']>();
    for (const r of records) {
      if (covered.has(r.reviewer)) continue;
      selected.push({ ...r, sha: head, carriedFrom: sha });
      found.add(r.reviewer);
    }
    for (const reviewer of found) covered.add(reviewer);
  }
  return selected;
}
