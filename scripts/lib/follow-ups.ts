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

/** A closed issue the gate checks: it carries a **Follow-up of:** line, so it was a follow-up when it was opened (#275). */
export interface ClosedFollowUp {
  number: number;
  labels: string[];
  body: string;
  /** GitHub's `stateReason` (`COMPLETED`, `NOT_PLANNED`, …). */
  stateReason: string | null;
  /** How many merged pull requests closed it (`closedByPullRequestsReferences`, each checked for a merge). */
  mergedClosers: number;
  comments: { author: string; body: string }[];
}

/**
 * Why a closed follow-up didn't land (#275): closed as not planned, closed with no merged PR closing it, or its
 * `follow-up` label taken off. Null when it landed. Closing an issue by hand is not landing it.
 */
export function landingProblem(issue: Omit<ClosedFollowUp, 'comments'>): string | null {
  const why: string[] = [];
  if (issue.stateReason === 'NOT_PLANNED') why.push('closed as not planned');
  if (issue.mergedClosers === 0) why.push('no merged pull request closed it');
  if (!issue.labels.includes('follow-up')) why.push('its `follow-up` label was removed');
  return why.length > 0 ? why.join(', ') : null;
}

/** Every PR a follow-up's **Follow-up of:** line names. */
export function followUpOf(body: string): number[] {
  const line = /^\*\*Follow-up of:\*\*(.*)$/m.exec(body)?.[1] ?? '';
  return [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/**
 * Zeus's exception, recorded on the follow-up itself: a comment from his account (which Athena uses) that opens with
 * Athena's dated record of his decision, and the decision is the grant for this very issue, ending there. A builder's
 * text that Athena posts starts otherwise, and a refusal or a question that only contains the phrase grants nothing
 * (Argus F2, Cerberus F2 on #170; Cerberus F1, Argus F3 in round 2).
 */
function excepted(
  issue: { number: number; comments: { author: string; body: string }[] },
  zeusLogin: string,
): boolean {
  // The grant ends the decision: a full stop (not the start of a number), or the end of the line. A colon, a dash or
  // a semicolon after `#N` opens a clause that may take it back (Cerberus F1 on #170 at fbb968e).
  const grant = new RegExp(
    `^🦉 Athena: Zeus decided \\(\\d{4}-\\d{2}-\\d{2}[^)]*\\):\\s*exception granted for #${String(issue.number)}[ \\t]*(?:\\.(?!\\d)|\\r?\\n|$)`,
    'iu',
  );
  return issue.comments.some((c) => c.author === zeusLogin && grant.test(c.body));
}

/**
 * A planned task's unticked Done-when items that carry the marker itself: `(follow-up of #N)` in parentheses. An item
 * that only talks about follow-ups in prose, or quotes the marker in backticks as an example, isn't one (#275: the live
 * red-team run on #170 showed four such items holding a batch). A marker in parentheses that names no `#N` still
 * counts, so the gate refuses it and Athena names the batch.
 */
function followUpItems(body: string): { text: string; batches: number[] }[] {
  const items: { text: string; batches: number[] }[] = [];
  // Any bullet, any indent, any case: an item that slips past this would merge unseen (Argus F4, Cerberus F3 on #170).
  for (const m of body.matchAll(/^\s*[-*+]\s+\[ \]\s+(.*follow-up.*)$/gim)) {
    const text = (m[1] ?? '').trim();
    // What is written in backticks is quoted, not meant.
    const meant = text.replace(/(`+)[^`]*\1/g, '');
    // Every batch the item names, in each `(follow-up of …)` it carries (Cerberus F2, Argus F4 in round 2).
    const markers = [...meant.matchAll(/\(\s*follow-up\b([^)]*)\)/gi)];
    if (markers.length === 0) continue;
    const batches = markers.flatMap((p) =>
      [...(p[1] ?? '').matchAll(/#(\d+)/g)].map((n) => Number(n[1])),
    );
    items.push({ text, batches });
  }
  return items;
}

/** Whether the gate needs an open issue's comments, for an exception: a follow-up, or a task with a follow-up item. */
export function wantsComments(labels: readonly string[], body: string): boolean {
  return labels.includes('follow-up') || followUpItems(body).length > 0;
}

/** The issues a batch's `Follow-up: #N` (or `Follow-ups: #N, #M`) lines link, once each. */
export function followUpLinks(comments: readonly string[]): number[] {
  return [
    ...new Set(
      comments.flatMap((c) =>
        // One line only: a `#N` that starts the next line is another thing, not part of the list (#275).
        [
          ...c.matchAll(/^[ \t]*(?:-[ \t]*)?Follow-ups?:[ \t]*((?:#\d+[ \t,]*(?:and[ \t]+)?)+)/gim),
        ].flatMap((m) => [...(m[1] ?? '').matchAll(/#(\d+)/g)].map((n) => Number(n[1]))),
      ),
    ),
  ];
}

export function followUpRefusals(o: {
  /** This batch PR. */
  pr: number;
  /** The issues this batch closes: a follow-up among them lands with it. */
  closes: readonly number[];
  /** The batch PRs the gate merged into main, from its merge log. */
  mergedBatches: readonly number[];
  openIssues: readonly OpenIssue[];
  /** Closed issues that carry a **Follow-up of:** line, with how they were closed (#275). */
  closedIssues: readonly ClosedFollowUp[];
  /**
   * The comments of each batch the gate merged into main (#277). Athena's own `Follow-up: #N` lines there are what an
   * earlier batch promised, so the gate checks those issues whatever their text says now.
   */
  earlierBatchComments: readonly { batch: number; comments: { author: string; body: string }[] }[];
  /** This batch PR's comments: only a `Follow-up: #N` line from Zeus's account links a follow-up (Argus F1 in round 2). */
  comments: readonly { author: string; body: string }[];
  /** Zeus's GitHub account, which Athena uses: only its records grant an exception. */
  zeusLogin: string;
  /** The open-issue list hit its limit: a follow-up past it would go unseen. */
  listCutOff: boolean;
  /** The closed-issue list hit its limit: a follow-up closed without landing past it would go unseen. */
  closedCutOff: boolean;
}): string[] {
  const earlier = (n: number) => n !== o.pr && o.mergedBatches.includes(n);
  const refusals: string[] = o.listCutOff
    ? [
        'the list of open issues may be cut off, so a follow-up could go unseen: Athena checks why there are so many',
      ]
    : [];
  if (o.closedCutOff)
    refusals.push(
      'the list of closed issues may be cut off, so a follow-up closed without landing could go unseen: Athena checks why there are so many',
    );
  // The issues an older check already refused, so the link check below doesn't say it twice.
  const refused = new Set<number>();
  // A follow-up of an earlier batch that was closed without landing (#275): closing it is not landing it.
  for (const issue of o.closedIssues) {
    if (excepted(issue, o.zeusLogin)) continue;
    const of = followUpOf(issue.body).find(earlier);
    const problem = landingProblem(issue);
    if (of !== undefined && problem !== null) {
      refused.add(issue.number);
      refusals.push(
        `#${String(issue.number)}, a follow-up of batch #${String(of)}, was closed without landing (${problem}): it lands (reopen it), or Zeus records an exception on it`,
      );
    }
  }
  for (const issue of o.openIssues) {
    if (o.closes.includes(issue.number) || excepted(issue, o.zeusLogin)) continue;
    if (issue.labels.includes('follow-up')) {
      const of = followUpOf(issue.body).find(earlier);
      if (of !== undefined) {
        refused.add(issue.number);
        refusals.push(
          `#${String(issue.number)}, a follow-up of batch #${String(of)}, is still open: it lands before the next batch merges (§19), or Zeus records an exception on it`,
        );
      }
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
  // A follow-up an earlier batch linked (#277), whatever its text says now: its `**Follow-up of:**` line or its label may
  // have been edited out, but Athena's record on the batch still names it. Only Zeus's account counts.
  const closedByNumber = new Map(o.closedIssues.map((i) => [i.number, i]));
  const openByNumber = new Map(o.openIssues.map((i) => [i.number, i]));
  for (const { batch, comments } of o.earlierBatchComments) {
    if (!earlier(batch)) continue;
    const mine = comments.filter((c) => c.author === o.zeusLogin).map((c) => c.body);
    for (const n of followUpLinks(mine)) {
      if (refused.has(n)) continue;
      const said = `#${String(n)}, linked as a follow-up of batch #${String(batch)}`;
      const stillOpen = openByNumber.get(n);
      const done = closedByNumber.get(n);
      if (stillOpen !== undefined) {
        if (o.closes.includes(n) || excepted(stillOpen, o.zeusLogin)) continue;
        refused.add(n);
        refusals.push(
          `${said}, is still open: it lands before the next batch merges (§19), or Zeus records an exception on it`,
        );
      } else if (done !== undefined) {
        const problem = landingProblem(done);
        if (problem === null || excepted(done, o.zeusLogin)) continue;
        refused.add(n);
        refusals.push(
          `${said}, was closed without landing (${problem}): it lands (reopen it), or Zeus records an exception on it`,
        );
      } else {
        refused.add(n);
        refusals.push(
          `${said}, is an issue the gate can't find, open or closed: Athena checks the link`,
        );
      }
    }
  }
  const open = new Map(o.openIssues.map((i) => [i.number, i]));
  const own = o.comments.filter((c) => c.author === o.zeusLogin).map((c) => c.body);
  for (const n of followUpLinks(own)) {
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
