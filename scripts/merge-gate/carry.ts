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

export interface CarryDeps {
  readReviews: (pr: number, sha: string) => ReviewRecord[];
  listReviewedShas: (pr: number) => string[];
  /** The change id of a commit (`changeId`); throws when git can't read the commit. */
  changeId: (sha: string) => string;
  /** The gate's transcript and snapshot check of one record, at the commit it was made for. */
  verify: (record: ReviewRecord, sha: string) => ReviewRecord;
}

/**
 * The records the gate judges at `head`, verified. Only an update since the last review carries: the newest reviewed
 * commit of the PR (by record time) must be the head's change, and only the run of commits with that change newer
 * than any other carries, so a block on a different version always stands. A record whose time doesn't parse, or a
 * commit git can't read, means nothing carries (fail closed).
 */
export function reviewsAt(pr: number, head: string, deps: CarryDeps): ReviewRecord[] {
  const own = deps.readReviews(pr, head).map((r) => deps.verify(r, head));
  const others = deps
    .listReviewedShas(pr)
    .filter((sha) => sha !== head)
    .map((sha) => ({ sha, records: deps.readReviews(pr, sha) }));
  if (others.length === 0) return own;
  if (others.some((o) => o.records.some((r) => Number.isNaN(Date.parse(r.at))))) return own;
  const sameChange = (() => {
    let headId: string;
    try {
      headId = deps.changeId(head);
    } catch {
      return () => false;
    }
    return (sha: string) => {
      try {
        return deps.changeId(sha) === headId;
      } catch {
        return false;
      }
    };
  })();
  const newestFirst = others
    .map((o) => ({ ...o, newest: Math.max(...o.records.map((r) => Date.parse(r.at))) }))
    .sort((a, b) => b.newest - a.newest);
  const run: { sha: string; records: ReviewRecord[] }[] = [];
  for (const o of newestFirst) {
    if (!sameChange(o.sha)) break;
    run.push({ sha: o.sha, records: o.records.map((r) => deps.verify(r, o.sha)) });
  }
  return selectReviews(head, own, run);
}
