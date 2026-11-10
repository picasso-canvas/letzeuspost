import type { OpenIssue } from '../lib/follow-ups.ts';
import type { JourneyEntry } from '../lib/journey-proof.ts';
import type { RawChange } from '../lib/protected.ts';
export const REVIEWERS = ['argus', 'cerberus', 'iris', 'redteam'] as const;
export type Reviewer = (typeof REVIEWERS)[number];
export type Verdict = 'pass' | 'block';
export type Tier = 'sensitive' | 'routine';

/** One verdict in Athena's local record, for one PR at one head commit and one PR text. Records are append-only. */
export interface ReviewRecord {
  pr: number;
  sha: string;
  reviewer: Reviewer;
  verdict: Verdict;
  bodyHash: string;
  summary: string;
  at: string;
  /** For runs by scripts/review.ts: which agent answered, in which Claude Code session. */
  meta?: { agent: string; sessionId: string | null; bundle?: string; verified?: boolean };
  /** Set by the gate when the record was made at an earlier head with the same change (carry.ts). */
  carriedFrom?: string;
}

/** `.github/merge-gate.json`, always read from `main`. */
export interface GateConfig {
  requiredChecks: string[];
  requireTierLabel: boolean;
  requireIris: boolean;
  uiPaths: string[];
  harnessPaths: string[];
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  /** The GitHub App that created the run; required checks must come from GitHub Actions. */
  app: string | null;
  /** The run's page (`…/actions/runs/<id>/job/<id>` for an Actions job), where the gate finds its artifacts (#156). */
  url?: string | null;
}

export interface ClosingIssue {
  number: number;
  /** False when the PR closes an issue in another repository. */
  inRepo: boolean;
  labels: string[];
  /** Boxes in the issue's own Done-when list, which Athena wrote. */
  doneWhenBoxes: number;
  /** The paths and globs on the issue's **Areas:** line (#138); null when it can't be read. */
  areas: string[] | null;
}

/** Everything the gate looks at. Only check runs, `main`'s files and the local record count as proof. */
export interface Facts {
  pr: number;
  paused: string | null;
  state: string;
  isDraft: boolean;
  baseRef: string;
  /** The PR's branch: `staging` marks the batch PR into `main` (only from this repository). */
  headRef: string;
  /** True when the PR's branch lives in another repository (a fork). */
  crossRepo: boolean;
  headSha: string;
  title: string;
  mergeable: string;
  behindBy: number | null;
  body: string;
  closingIssues: ClosingIssue[];
  changedFiles: string[];
  /** The changed files with their new modes (`git diff --raw`), for ship's refusals on staging and batch PRs. */
  changes: RawChange[];
  /** For a batch: first-parent commits on staging the gate didn't merge or sync (staging.ts). */
  ungatedStaging: string[];
  /** Task issues the merge log shows were merged into staging (a batch may close only these). */
  gatedIssues: number[];
  /** Commits the Done-when evidence may name: the head, and any reviewed commit it only merged main into (#138). */
  evidenceShas: string[];
  /** The previous review round's numbered findings (`Argus F1`), which a Round section must answer (#138). */
  earlierFindingIds: string[];
  /**
   * For a batch that completes a feature: the journey tests the `services` run on its head commit reported (#156);
   * `entries` is null when there's no report, and `unreadable` says why one can't be read. Null for any other PR, a
   * batch with no feature, and a part of a feature whose other tasks are still open.
   */
  journey: { feature: string; entries: JourneyEntry[] | null; unreadable?: string } | null;
  /** For a batch: the open issues, the batch PRs merged into main, and this PR's comments (#154, follow-ups). */
  openIssues: OpenIssue[];
  /** The open-issue list hit its limit (#170): the gate refuses rather than miss a follow-up. */
  openIssuesCutOff: boolean;
  mergedBatches: number[];
  /** A batch PR's comments with their authors: only Zeus's account links a follow-up (#154). */
  prComments: { author: string; body: string }[];
  labels: string[];
  checkRuns: CheckRun[];
  statuses: { context: string; state: string }[];
  reviews: ReviewRecord[];
  sensitivePatterns: string[] | null;
  /** `.github/cerberus-paths.txt` on main: the risky areas Cerberus reviews per PR into staging. Null: every one. */
  cerberusPatterns: string[] | null;
  config: GateConfig;
}

export interface ItemResult {
  id: number;
  title: string;
  ok: boolean;
  detail: string;
}

export interface GateResult {
  ok: boolean;
  tier: Tier;
  items: ItemResult[];
}
