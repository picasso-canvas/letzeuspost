// Follow-ups have to land (§19 step 6, Zeus 2026-11-10 on #136, #154): a should-fix or nit answered by a follow-up
// must land by the next batch. The merge gate refuses a batch into main while a follow-up of an earlier batch is
// still open (an issue labelled `follow-up`, or a planned task's Done-when item marked `(follow-up of #N)`), unless
// Zeus's exception is recorded on it; and it checks that each `Follow-up: #N` line on the batch names a real follow-up
// of this batch. A follow-up the batch itself closes has landed.

/** An open issue as the gate reads it: Athena's labels and text, and its comments. */
export interface OpenIssue {
  number: number;
  labels: string[];
  body: string;
  comments: string[];
}

/** Every PR a follow-up's **Follow-up of:** line names. */
function followUpOf(body: string): number[] {
  const line = /^\*\*Follow-up of:\*\*(.*)$/m.exec(body)?.[1] ?? '';
  return [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/** Zeus's exception, recorded on the follow-up itself: his comment, or Athena's dated record of his decision. */
function excepted(issue: OpenIssue): boolean {
  return issue.comments.some((c) =>
    /Zeus decided \(\d{4}-\d{2}-\d{2}[^)]*\)[^\n]*\bexception\b/i.test(c),
  );
}

/** The issues a batch's `Follow-up: #N` (or `Follow-ups: #N, #M`) lines link. */
function linked(comments: readonly string[]): number[] {
  return comments.flatMap((c) =>
    [...c.matchAll(/^\s*(?:-\s*)?Follow-ups?:\s*((?:#\d+[\s,]*(?:and\s+)?)+)/gim)].flatMap((m) =>
      [...(m[1] ?? '').matchAll(/#(\d+)/g)].map((n) => Number(n[1])),
    ),
  );
}

export function followUpRefusals(o: {
  /** This batch PR. */
  pr: number;
  /** The issues this batch closes: a follow-up among them lands with it. */
  closes: readonly number[];
  /** The batch PRs the gate merged into main, from its merge log. */
  mergedBatches: readonly number[];
  openIssues: readonly OpenIssue[];
  /** This batch PR's comments. */
  comments: readonly string[];
}): string[] {
  const earlier = (n: number) => n !== o.pr && o.mergedBatches.includes(n);
  const refusals: string[] = [];
  for (const issue of o.openIssues) {
    if (o.closes.includes(issue.number) || excepted(issue)) continue;
    if (issue.labels.includes('follow-up')) {
      const of = followUpOf(issue.body).find(earlier);
      if (of !== undefined)
        refusals.push(
          `#${String(issue.number)}, a follow-up of batch #${String(of)}, is still open: it lands before the next batch merges (§19), or Zeus records an exception on it`,
        );
    }
    for (const m of issue.body.matchAll(/^- \[ \] (.*\(follow-up of #(\d+)\).*)$/gm)) {
      const of = Number(m[2]);
      if (earlier(of))
        refusals.push(
          `#${String(issue.number)}'s Done-when item "${(m[1] ?? '').trim()}" is a follow-up of batch #${String(of)} and still unticked`,
        );
    }
  }
  const open = new Map(o.openIssues.map((i) => [i.number, i]));
  for (const n of [...new Set(linked(o.comments))]) {
    const issue = open.get(n);
    if (issue === undefined)
      refusals.push(
        `#${String(n)} is linked as a follow-up of this batch but is not an open issue`,
      );
    else if (!issue.labels.includes('follow-up') || !followUpOf(issue.body).includes(o.pr))
      refusals.push(
        `#${String(n)} is linked as a follow-up of this batch but has no \`follow-up\` label or no **Follow-up of:** #${String(o.pr)} line`,
      );
  }
  return refusals;
}
