import { createHash } from 'node:crypto';
import { shipRefusals } from '../lib/protected.ts';
import { matchesAny } from '../lib/paths.ts';
import type { Facts, GateConfig, GateResult, ItemResult, Reviewer, Tier } from './types.ts';
import { areaRefusals, evidenceRefusal, roundRefusals } from '../lib/handover-checks.ts';
import { followUpRefusals } from '../lib/follow-ups.ts';
import { journeyProof } from '../lib/journey-proof.ts';

/** Zeus's GitHub account, the repository's owner, which Athena works through (§20): only its records grant an exception. */
const ZEUS_LOGIN = 'picasso-canvas';

/** The PR text a review was given, normalised so only real edits change it. */
export function bodyHash(body: string): string {
  return createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex');
}

/** Markdown with code fences and HTML comments removed: boxes there aren't real. */
function visibleLines(markdown: string): string[] {
  const text = markdown.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker.charAt(0);
      if (fence === null) fence = kind;
      else if (kind === fence) fence = null;
      continue;
    }
    if (fence === null) lines.push(line);
  }
  return lines;
}

// A heading that ends the list must start at column 0: indented bold text inside an item doesn't.
const HEADING = /^(#{1,6}\s+\S|\*\*[^*]+\*\*)/;
const DONE_WHEN = /^\s{0,3}(#{1,6}\s*|\*\*)done[\s-]when/i;
// Any task-list marker (`-`, `*`, `+`, `1.`), optionally inside a blockquote.
const BOX = /^[\s>]*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/;

/** The box lines of a "Done when" list, each with whether it is ticked. */
function doneWhenLines(markdown: string): { ticked: boolean; line: string }[] {
  let inList = false;
  const boxes: { ticked: boolean; line: string }[] = [];
  for (const line of visibleLines(markdown)) {
    if (DONE_WHEN.test(line)) {
      inList = true;
      continue;
    }
    if (inList && HEADING.test(line)) inList = false;
    const box = inList ? BOX.exec(line) : null;
    if (box) boxes.push({ ticked: box[1] !== ' ', line });
  }
  return boxes;
}

/** Counts the checkboxes in a "Done when" list. */
export function doneWhenBoxes(markdown: string): { ticked: number; unticked: number } {
  const boxes = doneWhenLines(markdown);
  const ticked = boxes.filter((box) => box.ticked).length;
  return { ticked, unticked: boxes.length - ticked };
}

// `(proof: ci:<job>)` or `(proof: iris)` at the end of a box's own line: the gate, not the builder, proves the box (#253).
// Inline code is blanked first, so a box that only quotes a marker isn't marked.
const PROOF = /\(proof:\s*(?:(iris)|ci:\s*([\w.-]+))\s*\)\s*$/i;

/** Every box in a "Done when" list, in order, with the proof it names (`ci:<job>`, `iris`) or null, and whether it is ticked. */
export function doneWhenMarks(markdown: string): { proof: string | null; ticked: boolean }[] {
  return doneWhenLines(markdown).map(({ ticked, line }) => {
    const found = PROOF.exec(line.replace(/`[^`]*`/g, ''));
    if (found === null) return { proof: null, ticked };
    return { proof: found[1] === undefined ? `ci:${String(found[2])}` : 'iris', ticked };
  });
}

/** A scoped job's first step is named `Scope (…)`: it can skip the job's checks and let the job pass (#160). */
const SCOPE_STEP = /^Scope \(/;
/** The step a scoped job ends with, which runs only when its scope step said `run=true` and every step before it passed. */
const RAN_STEP = 'Scoped checks ran';

/**
 * Whether a scoped job ran its checks (#264): null for a job with no scope step, which has nothing to skip. A scoped
 * job without the closing step, or whose closing step didn't succeed, didn't run them: its green check proves nothing.
 */
export function scopedJobRan(steps: { name: string; conclusion: string | null }[]): boolean | null {
  if (!steps.some((step) => SCOPE_STEP.test(step.name))) return null;
  return steps.some((step) => step.name === RAN_STEP && step.conclusion === 'success');
}

/** Why a proof named on a Done-when box doesn't hold for this head commit; null when it does. */
function proofRefusal(f: Facts, proof: string, hash: string): string | null {
  const head = f.headSha.slice(0, 7);
  if (proof === 'iris') {
    const passes = f.reviews.filter(
      (r) =>
        r.pr === f.pr &&
        r.sha === f.headSha &&
        r.reviewer === 'iris' &&
        r.verdict === 'pass' &&
        r.meta?.verified === true,
    );
    if (passes.length === 0) return `no Iris pass from scripts/review.ts for ${head}`;
    if (!passes.some((r) => r.bodyHash === hash)) return 'PR text changed since Iris reviewed';
    return null;
  }
  const job = proof.slice('ci:'.length);
  const runs = f.checkRuns.filter((run) => run.name === job);
  if (runs.length === 0) return `CI job "${job}" has no run`;
  const onHead = runs.filter((run) => run.sha === f.headSha);
  if (onHead.length === 0) return `CI job "${job}" has no run on ${head} (only an older commit)`;
  if (onHead.some((run) => run.app !== 'github-actions')) {
    return `CI job "${job}" didn't come from GitHub Actions`;
  }
  const bad = onHead.find((run) => run.status !== 'completed' || run.conclusion !== 'success');
  if (bad !== undefined) {
    return `CI job "${job}" is ${bad.status === 'completed' ? String(bad.conclusion) : bad.status} on ${head}`;
  }
  // A scoped job passes without running anything when the PR can't affect it; that doesn't prove a box (#264).
  // Steps the gate couldn't read count as a run that didn't happen.
  const skipped = onHead.find(
    (run) => run.steps === undefined || scopedJobRan(run.steps) === false,
  );
  if (skipped !== undefined) {
    return `CI job "${job}" passed on ${head} without running its checks (its scope step skipped them), so it proves nothing`;
  }
  return null;
}

export function workOutTier(f: Facts): Tier {
  return tierOf(f.changedFiles, f.sensitivePatterns);
}

export function tierOf(changedFiles: readonly string[], sensitivePatterns: string[] | null): Tier {
  if (sensitivePatterns === null) return 'sensitive';
  return changedFiles.some((file) => matchesAny(file, sensitivePatterns)) ? 'sensitive' : 'routine';
}

/** The reviewers the gate needs: Argus; Cerberus when sensitive; Iris for UI paths once enabled. */
export function requiredReviewers(
  changedFiles: readonly string[],
  sensitivePatterns: string[] | null,
  config: Pick<GateConfig, 'requireIris' | 'uiPaths'>,
): Exclude<Reviewer, 'redteam'>[] {
  const needed: Exclude<Reviewer, 'redteam'>[] = ['argus'];
  if (tierOf(changedFiles, sensitivePatterns) === 'sensitive') needed.push('cerberus');
  if (config.requireIris && changedFiles.some((p) => matchesAny(p, config.uiPaths)))
    needed.push('iris');
  return needed;
}

/**
 * What kind of merge this is (Zeus, 2026-11-07): a builder PR into `staging`; the batch PR from `staging` into
 * `main`; or a harness PR (Athena's) straight into `main`. Anything else is refused.
 */
export function kindOf(
  f: Pick<Facts, 'baseRef' | 'headRef' | 'crossRepo'>,
): 'staging' | 'batch' | 'main' | null {
  if (f.baseRef === 'staging') return 'staging';
  if (f.baseRef === 'main') {
    if (f.headRef !== 'staging') return 'main';
    return f.crossRepo ? null : 'batch'; // a fork's branch named staging is never the batch
  }
  return null;
}

/** Into staging, only Cerberus reviews, and only a PR touching a risky area; without the list on main, every PR. */
export function stagingReviewers(
  changedFiles: readonly string[],
  cerberusPatterns: string[] | null,
): Exclude<Reviewer, 'redteam'>[] {
  if (cerberusPatterns === null) return ['cerberus'];
  return changedFiles.some((file) => matchesAny(file, cerberusPatterns)) ? ['cerberus'] : [];
}

// GitHub skips push CI on `main` when the merge commit's message carries one of these.
const SKIP_CI = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|skip-checks:\s*true/i;

export function evaluate(f: Facts): GateResult {
  const tier = workOutTier(f);
  const labels = f.labels.map((label) => label.toLowerCase());
  const items: ItemResult[] = [];
  const add = (id: number, title: string, problems: string[]) => {
    items.push({ id, title, ok: problems.length === 0, detail: problems.join('; ') || 'ok' });
  };

  // 1. Not frozen
  const paused = f.paused?.trim().toLowerCase();
  add(1, 'Not frozen', paused === 'false' ? [] : [`AGENTS_PAUSED is ${JSON.stringify(f.paused)}`]);

  // 2. Linked and current
  const kind = kindOf(f);
  const linked: string[] = [];
  if (f.state !== 'OPEN') linked.push(`state is ${f.state}`);
  if (f.isDraft) linked.push('draft');
  if (kind === null)
    linked.push(`base is ${f.baseRef}: PRs go into staging, or into main as a batch or harness PR`);
  if (f.mergeable !== 'MERGEABLE')
    linked.push(`mergeable is ${f.mergeable} (try again if UNKNOWN)`);
  if (f.behindBy !== 0)
    linked.push(`branch is behind ${f.baseRef} by ${String(f.behindBy ?? 'unknown')}`);
  if (f.changedFiles.length === 0) linked.push('no changed files');
  if (kind === 'batch') {
    for (const issue of f.closingIssues) {
      if (!f.gatedIssues.includes(issue.number))
        linked.push(`#${String(issue.number)} wasn't merged into staging through the gate`);
    }
  }
  // Athena's own PRs get ship's Areas check (#138): builders' PRs had it at ship, and a batch's tasks each did.
  if (kind === 'main') {
    // A build task's Areas (Argus F2 on #152): a section or feedback issue has none to check.
    const buildTasks = f.closingIssues.filter(
      (i) => i.inRepo && i.labels.some((l) => l.toLowerCase() === 'build-task'),
    );
    for (const issue of buildTasks) {
      if (issue.areas === null) linked.push(`#${String(issue.number)}'s Areas can't be read`);
      else linked.push(...areaRefusals(f.changedFiles, issue.areas));
    }
  }
  // An earlier batch's follow-ups land before this one merges, and this batch's follow-up links are real (#154).
  if (kind === 'batch')
    linked.push(
      ...followUpRefusals({
        pr: f.pr,
        closes: f.closingIssues.map((i) => i.number),
        mergedBatches: f.mergedBatches,
        openIssues: f.openIssues,
        closedIssues: f.closedFollowUps,
        earlierBatchComments: f.earlierBatchComments,
        comments: f.prComments,
        zeusLogin: ZEUS_LOGIN,
        listCutOff: f.openIssuesCutOff,
        closedCutOff: f.closedCutOff,
      }),
    );
  if (kind === 'batch' && f.ungatedStaging.length > 0) {
    linked.push(
      `staging holds commits that didn't come through the gate: ${f.ungatedStaging.map((sha) => sha.slice(0, 7)).join(', ')}`,
    );
  }
  if (SKIP_CI.test(f.title)) linked.push('the title would skip CI on main');
  if (f.closingIssues.some((issue) => !issue.inRepo)) {
    linked.push('closes an issue in another repository');
  }
  const tasks = f.closingIssues.filter(
    (issue) =>
      issue.inRepo &&
      issue.labels.some((l) => l.toLowerCase() === 'build-task' || l.toLowerCase() === 'section'),
  );
  const onlyPlainMarkdown =
    f.changedFiles.length > 0 &&
    f.changedFiles.every(
      (p) => p.toLowerCase().endsWith('.md') && !matchesAny(p, f.config.harnessPaths),
    );
  if (tasks.length === 0 && !onlyPlainMarkdown) {
    linked.push('closes no build-task or section issue, and changes more than plain Markdown');
  }
  add(2, 'Linked and current', linked);

  // 3. Checks green; required checks must come from GitHub Actions
  const checks: string[] = [];
  if (f.config.requiredChecks.length === 0) checks.push('no required checks configured on main');
  for (const name of f.config.requiredChecks) {
    const runs = f.checkRuns.filter((run) => run.name === name);
    if (runs.length === 0) checks.push(`required check "${name}" missing`);
    else if (runs.some((run) => run.app !== 'github-actions')) {
      checks.push(`required check "${name}" didn't come from GitHub Actions`);
    }
  }
  for (const run of f.checkRuns) {
    if (run.status !== 'completed') checks.push(`"${run.name}" is ${run.status}`);
    else if (run.conclusion !== 'success') {
      checks.push(`"${run.name}" concluded ${String(run.conclusion)}`);
    }
  }
  for (const status of f.statuses) {
    if (status.state !== 'success') checks.push(`status "${status.context}" is ${status.state}`);
  }
  // A batch that completes features: CI's own report shows each journey ran and passed (§19, #156, #265). An
  // unreadable report is one fact, said once; a journey's own failures name its test files.
  if (kind === 'batch') {
    const unreadable = new Set<string>();
    for (const journey of f.journeys) {
      if (journey.unreadable !== undefined) unreadable.add(journey.unreadable);
      else checks.push(...journeyProof(journey.entries, journey.feature, journey.files));
    }
    for (const why of unreadable)
      checks.push(`the journey report of the services run on this commit can't be read: ${why}`);
  }
  add(3, 'Checks green', checks);

  // 4. Tier worked out, not read
  const tierLabels = labels.filter((label) => label === 'sensitive' || label === 'routine');
  const tierProblems: string[] = [];
  if (tierLabels.length > 1) tierProblems.push('both tier labels are set');
  else if (tierLabels.length === 1 && tierLabels[0] !== tier) {
    tierProblems.push(`label says ${String(tierLabels[0])}, the paths say ${tier}`);
  } else if (tierLabels.length === 0 && f.config.requireTierLabel) {
    tierProblems.push('no tier label from the risk gate');
  }
  add(4, `Tier (${tier})`, tierProblems);

  // 5. Fresh-context reviews for this commit and this PR text; any block on this commit refuses
  const hash = bodyHash(f.body);
  const current = f.reviews.filter((r) => r.pr === f.pr && r.sha === f.headSha);
  const needed: Reviewer[] =
    kind === 'staging'
      ? stagingReviewers(f.changedFiles, f.cerberusPatterns)
      : requiredReviewers(f.changedFiles, f.sensitivePatterns, f.config);
  const reviewProblems: string[] = [];
  for (const r of current) {
    if (r.verdict === 'block') reviewProblems.push(`${r.reviewer} blocked this commit`);
  }
  for (const reviewer of needed) {
    // A pass counts only when scripts/review.ts made it: a real Claude Code session, not a hand-written summary.
    const passes = current.filter(
      (r) => r.reviewer === reviewer && r.verdict === 'pass' && r.meta?.verified === true,
    );
    if (passes.length === 0) {
      reviewProblems.push(
        `no ${reviewer} pass from scripts/review.ts for ${f.headSha.slice(0, 7)}`,
      );
    } else if (!passes.some((r) => r.bodyHash === hash)) {
      reviewProblems.push(`PR text changed since ${reviewer} reviewed`);
    }
  }
  add(5, `Reviews (${needed.join(', ')})`, reviewProblems);

  // 6. Done-when complete, and at least as long as the issue's own list
  const boxes = doneWhenBoxes(f.body);
  const marks = doneWhenMarks(f.body);
  const doneProblems: string[] = [];
  // A box that names a proof is closed by the proof, not by the tick: the job or Iris's verdict must hold for this head.
  // The proof must sit on the same box of the closing issue's own list (Athena's), and no marker may be dropped from it.
  // A batch PR ticks one box per task and names no proofs.
  let proven = 0;
  marks.forEach(({ proof, ticked }, index) => {
    if (proof === null) return;
    const box = `box ${String(index + 1)}`;
    if (kind === 'batch') {
      doneProblems.push(`${box} names "${proof}", and a batch PR names no proofs`);
      return;
    }
    if (!tasks.some((issue) => issue.proofs[index] === proof)) {
      doneProblems.push(
        `${box} names "${proof}", but the closing issue's list has no such proof on ${box}`,
      );
      return;
    }
    const problem = proofRefusal(f, proof, hash);
    if (problem !== null) doneProblems.push(problem);
    else if (!ticked) proven++;
  });
  if (kind !== 'batch') {
    for (const issue of tasks) {
      issue.proofs.forEach((proof, index) => {
        if (proof !== null && marks[index]?.proof !== proof) {
          doneProblems.push(
            `box ${String(index + 1)} lost its "${proof}" marker from issue #${String(issue.number)}`,
          );
        }
      });
    }
  }
  const unticked = boxes.unticked - marks.filter((m) => m.proof !== null && !m.ticked).length;
  if (boxes.ticked + boxes.unticked === 0)
    doneProblems.push('no Done-when checklist in the PR text');
  if (unticked > 0) doneProblems.push(`${String(unticked)} unticked`);
  // A batch PR ticks one box per task (each task's own list was checked when it merged into staging).
  const expected =
    kind === 'batch' ? tasks.length : Math.max(0, ...tasks.map((issue) => issue.doneWhenBoxes));
  if (boxes.ticked + proven < expected) {
    doneProblems.push(
      `${String(boxes.ticked + proven)} ticked or proven, the issue lists ${String(expected)}`,
    );
  }
  // Athena's own PRs: the evidence names a commit the reviews hold for, and a fix round answers each finding (#138).
  if (kind === 'main') {
    const evidence = evidenceRefusal(f.body, f.evidenceShas);
    if (evidence !== null) doneProblems.push(evidence);
    doneProblems.push(...roundRefusals(f.body, f.earlierFindingIds));
  }
  add(6, 'Done-when complete', doneProblems);

  // 7. Harness changes re-tested
  const harness = f.changedFiles.filter((p) => matchesAny(p, f.config.harnessPaths));
  const redTeam = current.filter((r) => r.reviewer === 'redteam' && r.verdict === 'pass');
  const harnessProblems: string[] = [];
  if (kind !== 'main') {
    // Harness and builder-protected paths, symlinks and submodules never go through staging (Zeus, 2026-11-07):
    // ship refuses them, and so does the gate, in case a branch changed after ship.
    if (harness.length > 0)
      harnessProblems.push(`harness paths can't go through staging (${harness.join(', ')})`);
    harnessProblems.push(
      ...shipRefusals(f.changes).filter((reason) => reason !== 'the branch changes nothing'),
    );
  } else if (harness.length > 0) {
    if (redTeam.length === 0) {
      harnessProblems.push(`harness paths changed (${harness.join(', ')}), no red-team record`);
    } else if (!redTeam.some((r) => r.bodyHash === hash)) {
      harnessProblems.push('PR text changed since the red-team record');
    }
  }
  add(7, 'Harness changes re-tested', harnessProblems);

  return { ok: items.every((item) => item.ok), tier, items };
}
