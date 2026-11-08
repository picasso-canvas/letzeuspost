// The environment for Athena's own git commands in dispatch and ship (#87). The system git config stays off, as in
// every harness git call, so on this Mac its `osxkeychain` helper is gone too: GitHub gets Athena's login through gh
// instead, the login every other harness call to GitHub uses, and only for https://github.com. Builders never get
// this: dispatch's builderEnv starts them with no credential helper at all (§20 part 1).

/** `from`, with the system git config off and `gh auth git-credential` answering git for https://github.com. */
export function athenaGitEnv(from: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const n = Number(from.GIT_CONFIG_COUNT ?? '0') || 0;
  return {
    ...from,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${String(n)}`]: 'credential.https://github.com.helper',
    [`GIT_CONFIG_VALUE_${String(n)}`]: '!gh auth git-credential',
  };
}
