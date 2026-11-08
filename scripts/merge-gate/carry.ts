import { createHash } from 'node:crypto';
import type { ReviewRecord } from './types.ts';

/**
 * What a PR changes on its own: every changed path with its old and new mode and blob, against the PR's merge-base
 * with main. Merging main in leaves it unchanged unless main touched one of the PR's files (then its old blob moves)
 * or the merge changed the PR's result. Equal ids mean the reviewers saw exactly this change.
 */
export function changeId(git: (args: string[]) => string, sha: string, branch = 'main'): string {
  const base = git(['merge-base', `origin/${branch}`, sha]).trim();
  const raw = git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, sha]);
  return createHash('sha256').update(raw).digest('hex');
}

export interface CarryDeps {
  readReviews: (pr: number, sha: string) => ReviewRecord[];
  listReviewedShas: (pr: number) => string[];
  /** The change id of a commit (`changeId`); throws when git can't read the commit. */
  changeId: (sha: string) => string;
  /** The gate's transcript and snapshot check of one record, at the commit it was made for. */
  verify: (record: ReviewRecord, sha: string) => ReviewRecord;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * The records the gate judges at `head`, verified. Each reviewer is judged on its own: a reviewer with any record at
 * the head is judged on those alone; otherwise its records carry from the commit of its own newest record, only when
 * that commit is the head's change (an update from main since that review). So a block on a different version always
 * stands, whatever other reviewers did later. A record whose time isn't ISO, a tie between two commits, or a commit
 * git can't read means nothing carries for that reviewer (fail closed).
 */
export function reviewsAt(pr: number, head: string, deps: CarryDeps): ReviewRecord[] {
  const own = deps.readReviews(pr, head).map((r) => deps.verify(r, head));
  const others = deps
    .listReviewedShas(pr)
    .filter((sha) => sha !== head)
    .map((sha) => ({ sha, records: deps.readReviews(pr, sha) }));
  if (others.length === 0) return own;
  if (others.some((o) => o.records.some((r) => !ISO.test(r.at)))) return own;
  let headId: string | null;
  try {
    headId = deps.changeId(head);
  } catch {
    headId = null;
  }
  const sameChange = (sha: string): boolean => {
    try {
      return headId !== null && deps.changeId(sha) === headId;
    } catch {
      return false;
    }
  };
  const covered = new Set(own.map((r) => r.reviewer));
  const carried: ReviewRecord[] = [];
  const reviewers = [...new Set(others.flatMap((o) => o.records.map((r) => r.reviewer)))];
  for (const reviewer of reviewers) {
    if (covered.has(reviewer)) continue;
    const newestAt = (o: (typeof others)[number]) =>
      Math.max(...o.records.filter((r) => r.reviewer === reviewer).map((r) => Date.parse(r.at)));
    const ranked = others
      .filter((o) => o.records.some((r) => r.reviewer === reviewer))
      .map((o) => ({ ...o, newest: newestAt(o) }))
      .sort((a, b) => b.newest - a.newest);
    const [first, second] = ranked;
    if (first === undefined || (second !== undefined && second.newest === first.newest)) continue;
    if (!sameChange(first.sha)) continue;
    for (const r of first.records.filter((x) => x.reviewer === reviewer)) {
      carried.push({ ...deps.verify(r, first.sha), sha: head, carriedFrom: first.sha });
    }
  }
  return [...own, ...carried];
}
