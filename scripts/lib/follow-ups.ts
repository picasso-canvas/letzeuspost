// Follow-ups have to land (§19 step 6, Zeus 2026-11-10 on #136, #154): a should-fix or nit answered by a follow-up
// must land by the next batch. The merge gate refuses a batch into main while a follow-up of an earlier batch is
// still open (an issue labelled `follow-up`, or a planned task's Done-when item marked `(follow-up of #N)`), unless
// Zeus's exception is recorded on it; and it checks that each `Follow-up: #N` line from Zeus's account (which Athena
// uses) on the batch names a real follow-up of this batch. A follow-up the batch itself closes has landed.

/** An open issue as the gate reads it: Athena's labels and text, and (for a follow-up) its comments with authors. */
export interface OpenIssue {
  number: number;
  labels: string[];
  body: string;
  comments: { author: string; body: string }[];
}

/** Every PR a follow-up's **Follow-up of:** line names. */
function followUpOf(body: string): number[] {
  const line = /^\*\*Follow-up of:\*\*(.*)$/m.exec(body)?.[1] ?? '';
  return [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/**
 * Zeus's exception, recorded on the follow-up itself: a comment from his account (which Athena uses) that opens with
 * Athena's dated record of his decision, and the decision is the grant for this very issue, ending there. A builder's
 * text that Athena posts starts otherwise, and a refusal or a question that only contains the phrase grants nothing
 * (Argus F2, Cerberus F2 on #170; Cerberus F1, Argus F3 in round 2).
 */
function excepted(issue: OpenIssue, zeusLogin: string): boolean {
  const grant = new RegExp(
    `^🦉 Athena: Zeus decided \\(\\d{4}-\\d{2}-\\d{2}[^)]*\\):\\s*exception granted for #${String(issue.number)}(?:[.;:—–]|\\s*$)`,
    'iu',
  );
  return issue.comments.some((c) => c.author === zeusLogin && grant.test(c.body));
}

/** A planned task's unticked Done-when items that mark themselves as follow-ups, each with its text. */
function followUpItems(body: string): { text: string; batches: number[] }[] {
  // Any bullet, any indent, any case: an item that slips past this would merge unseen (Argus F4, Cerberus F3 on #170).
  return [...body.matchAll(/^\s*[-*+]\s+\[ \]\s+(.*follow-up of.*)$/gim)].map((m) => {
    const text = (m[1] ?? '').trim();
    // Every batch the item names, in each `(follow-up of …)` it carries (Cerberus F2, Argus F4 in round 2).
    const batches = [...text.matchAll(/\(follow-up of ([^)]*)\)/gi)].flatMap((p) =>
      [...(p[1] ?? '').matchAll(/#(\d+)/g)].map((n) => Number(n[1])),
    );
    return { text, batches };
  });
}

/** Whether the gate needs an open issue's comments, for an exception: a follow-up, or a task with a follow-up item. */
export function wantsComments(labels: readonly string[], body: string): boolean {
  return labels.includes('follow-up') || followUpItems(body).length > 0;
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
  /** This batch PR's comments: only a `Follow-up: #N` line from Zeus's account links a follow-up (Argus F1 in round 2). */
  comments: readonly { author: string; body: string }[];
  /** Zeus's GitHub account, which Athena uses: only its records grant an exception. */
  zeusLogin: string;
  /** The open-issue list hit its limit: a follow-up past it would go unseen. */
  listCutOff: boolean;
}): string[] {
  const earlier = (n: number) => n !== o.pr && o.mergedBatches.includes(n);
  const refusals: string[] = o.listCutOff
    ? [
        'the list of open issues may be cut off, so a follow-up could go unseen: Athena checks why there are so many',
      ]
    : [];
  for (const issue of o.openIssues) {
    if (o.closes.includes(issue.number) || excepted(issue, o.zeusLogin)) continue;
    if (issue.labels.includes('follow-up')) {
      const of = followUpOf(issue.body).find(earlier);
      if (of !== undefined)
        refusals.push(
          `#${String(issue.number)}, a follow-up of batch #${String(of)}, is still open: it lands before the next batch merges (§19), or Zeus records an exception on it`,
        );
    }
    for (const item of followUpItems(issue.body)) {
      if (item.batches.length === 0)
        refusals.push(
          `#${String(issue.number)}'s Done-when item "${item.text}" says it is a follow-up but names no batch PR (#N): Athena names it`,
        );
      for (const of of item.batches.filter(earlier))
        refusals.push(
          `#${String(issue.number)}'s Done-when item "${item.text}" is a follow-up of batch #${String(of)} and still unticked`,
        );
    }
  }
  const open = new Map(o.openIssues.map((i) => [i.number, i]));
  const own = o.comments.filter((c) => c.author === o.zeusLogin).map((c) => c.body);
  for (const n of [...new Set(linked(own))]) {
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
