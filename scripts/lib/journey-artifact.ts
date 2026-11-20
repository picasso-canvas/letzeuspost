// Whether `gh run download` failed because the artifact isn't there (#171, #280): never uploaded, or past its 30 days.
// The merge gate then reads the run as having no journey report and refuses the batch with a reason. Any other failure
// (a network error, a rate limit, an auth error) says nothing about the artifact, so the gate stops rather than drop a
// report.

/** gh's two answers: "no artifact matches any of the names or patterns provided", and "no valid artifacts found to download". */
const MISSING = /no artifact matches|no valid artifacts found to download/i;

export function isMissingArtifact(stderr: unknown): boolean {
  return typeof stderr === 'string' && MISSING.test(stderr);
}
