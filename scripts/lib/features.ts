// Feature batches (§19, Zeus 2026-11-10, #139): one feature open at a time on `staging`; its tasks build in parallel,
// and its batch into `main` opens when every one of them is on `staging` and its journey test is no longer marked as
// expected to fail, or as a part when `staging` outgrows the size cap. Follow-ups of a merged batch, and harness
// tasks, run alongside. Dispatch and batch.ts gather the facts; these functions decide.

/** An issue as dispatch and batch.ts read it (its labels and milestone are Athena's; its body is Athena's text). */
export interface TaskIssue {
  number: number;
  labels: string[];
  milestone: string | null;
  body: string;
}

export const BATCH_LINES = 1500;

/** The feature a task belongs to, from its `feature:<slug>` label; two labels are an error. */
export function featureOf(labels: readonly string[]): string | null {
  const features = labels
    .filter((l) => l.startsWith('feature:'))
    .map((l) => l.slice('feature:'.length));
  if (features.length > 1) throw new Error(`two features (${features.join(', ')})`);
  return features[0] ?? null;
}

/** The batch PR a follow-up names on its **Follow-up of:** line, or null. */
export function followUpOf(body: string): number | null {
  const n = /^\*\*Follow-up of:\*\*\s*#(\d+)/m.exec(body)?.[1];
  return n === undefined ? null : Number(n);
}

/** A follow-up of a batch already merged into main: it rides whatever batch is open (Zeus, 2026-11-10, on #142). */
function isFollowUp(task: TaskIssue, isMergedBatch: (pr: number) => boolean): boolean {
  const of = followUpOf(task.body);
  return task.labels.includes('follow-up') && of !== null && isMergedBatch(of);
}

/**
 * Why dispatch must refuse this task, or null. `active` holds the other dispatched tasks whose issues are still open
 * (on `staging`, or with a builder working on them).
 */
export function dispatchRefusal(
  task: TaskIssue,
  active: readonly TaskIssue[],
  isMergedBatch: (pr: number) => boolean,
): string | null {
  let feature: string | null;
  try {
    feature = featureOf(task.labels);
  } catch (error) {
    return `#${String(task.number)} has ${error instanceof Error ? error.message : String(error)}`;
  }
  if (feature === null) {
    // Harness tasks run alongside any feature, follow-ups of harness PRs among them.
    if (task.milestone === 'H0 Harness') return null;
    if (task.labels.includes('follow-up'))
      return isFollowUp(task, isMergedBatch)
        ? null
        : `#${String(task.number)} is labelled follow-up but its **Follow-up of:** line names no batch PR merged into main`;
    return `#${String(task.number)} has no feature:<slug> label: Athena labels it first (§19)`;
  }
  const open = new Map<string, number[]>();
  for (const other of active) {
    if (other.number === task.number) continue;
    let theirs: string | null;
    try {
      theirs = featureOf(other.labels);
    } catch {
      return `#${String(other.number)}, already dispatched, has two features: Athena fixes its labels first`;
    }
    if (theirs !== null && theirs !== feature)
      open.set(theirs, [...(open.get(theirs) ?? []), other.number]);
  }
  const [other, numbers] = [...open.entries()][0] ?? [];
  if (other === undefined) return null;
  return `feature "${other}" is open (${(numbers ?? []).map((n) => `#${String(n)}`).join(', ')}): #${String(task.number)} of feature "${feature}" waits until its batch merges`;
}

// The marks that switch a test runner's test off or expect it to fail, on an `it`, `test`, `describe` or `suite` chain
// only (so `query.skip(10)` or `assert.fail()` don't count): a method (it.fails, test.skip, test.fixme, it.todo,
// describe.skip, test.describe.skip, .only, it.skipIf(…), test.runIf(…)), the same through brackets (it['fails']), an
// alias (const j = it.fails), a destructured one (const { fails } = it), and Vitest's option form ({ fails: true }).
// This is an early warning, not the guard: a test can be switched off in ways no pattern finds. #156 opens a feature's
// batch only on CI's proof that its journey ran and passed (Zeus, 2026-11-10, on #139).
const MARK = '(?:fails?|skip|skipIf|runIf|fixme|todo|only)';
const RUNNER = '\\b(?:it|test|describe|suite)\\b';
const SWITCHED_OFF = new RegExp(
  [
    `${RUNNER}(?:\\s*\\.\\s*\\w+)*\\s*\\.\\s*${MARK}\\b`,
    `${RUNNER}(?:\\s*\\.\\s*\\w+)*\\s*\\[\\s*['"\`]${MARK}['"\`]\\s*\\]`,
    `\\{[^}]*\\b${MARK}\\b[^}]*\\}\\s*=\\s*${RUNNER}`,
    '\\b(?:fails|skip|todo)\\s*:\\s*true\\b',
  ].join('|'),
);

/**
 * Whether the feature's journey still counts as not done: it has no journey test (`tests/journeys/<feature>.*` or
 * `tests/journeys/<feature>/…`), or one of them carries a mark that switches it off or expects it to fail. An early
 * warning only (see SWITCHED_OFF); the guard is CI's result (#156).
 */
export function journeyMarked(
  files: readonly { path: string; text: string }[],
  feature: string,
): boolean {
  const own = files.filter(
    ({ path }) =>
      path.startsWith(`tests/journeys/${feature}.`) ||
      path.startsWith(`tests/journeys/${feature}/`),
  );
  return own.length === 0 || own.some(({ text }) => SWITCHED_OFF.test(text));
}

/** GitHub's issue JSON (`number,labels,milestone,body`) as the rules read it. */
export function toTaskIssue(view: {
  number: number;
  labels: { name: string }[];
  milestone: { title: string } | null;
  body: string;
}): TaskIssue {
  return {
    number: view.number,
    labels: view.labels.map((l) => l.name),
    milestone: view.milestone?.title ?? null,
    body: view.body,
  };
}

/** The one feature on staging, none (only tasks without one), or why there can't be one. */
export function stagingFeature(
  onStaging: readonly number[],
  issues: Readonly<Record<number, TaskIssue>>,
): { feature: string | null } | { refusal: string } {
  const features: string[] = [];
  for (const n of onStaging) {
    const issue = issues[n];
    if (issue === undefined) continue;
    let feature: string | null;
    try {
      feature = featureOf(issue.labels);
    } catch (error) {
      return {
        refusal: `#${String(n)} has ${error instanceof Error ? error.message : String(error)}: Athena fixes its labels first`,
      };
    }
    if (feature !== null && !features.includes(feature)) features.push(feature);
  }
  if (features.length > 1) return { refusal: `staging holds two features: ${features.join(', ')}` };
  return { feature: features[0] ?? null };
}

/**
 * Whether the batch is due. `onStaging` are the task issues the gate merged into `staging` since `main`;
 * `featureTasks` are the open feature's open task issues, wherever they are.
 */
export function featureBatch(input: {
  onStaging: readonly number[];
  issues: Readonly<Record<number, TaskIssue>>;
  featureTasks: readonly number[];
  journeyMarked: boolean;
  lines: number;
}): { due: boolean; feature: string | null; reason: string } {
  if (input.onStaging.length === 0)
    return { due: false, feature: null, reason: 'staging holds no task' };
  const found = stagingFeature(input.onStaging, input.issues);
  if ('refusal' in found) return { due: false, feature: null, reason: found.refusal };
  const feature = found.feature;
  const list = (ns: readonly number[]) => ns.map((n) => `#${String(n)}`).join(', ');
  if (feature === null)
    return {
      due: true,
      feature: null,
      reason: `staging holds only tasks with no feature (${list(input.onStaging)})`,
    };
  if (input.lines >= BATCH_LINES)
    return {
      due: true,
      feature,
      reason: `staging is ${String(input.lines)} changed lines ahead: a part of feature "${feature}"`,
    };
  const missing = input.featureTasks.filter((n) => !input.onStaging.includes(n));
  if (missing.length > 0)
    return {
      due: false,
      feature,
      reason: `feature "${feature}" still needs ${list(missing)} on staging`,
    };
  if (input.journeyMarked)
    return {
      due: false,
      feature,
      reason: `feature "${feature}"'s journey test is still marked as expected to fail`,
    };
  return {
    due: true,
    feature,
    reason: `every task of feature "${feature}" is on staging (${list(input.featureTasks)})`,
  };
}
