/** What the merge gate was asked to do (§19). `--sync-staging` only brings `main` into `staging`; it merges no PR. */
export type GateArgs =
  { kind: 'pr'; pr: number; dryRun: boolean } | { kind: 'sync-staging' } | { kind: 'usage' };

export function parseArgs(argv: string[]): GateArgs {
  const flags = argv.filter((a) => a.startsWith('--'));
  const rest = argv.filter((a) => !a.startsWith('--'));
  if (flags.includes('--sync-staging')) {
    return argv.length === 1 ? { kind: 'sync-staging' } : { kind: 'usage' };
  }
  if (flags.some((f) => f !== '--dry-run')) return { kind: 'usage' };
  const pr = Number(rest[0]);
  if (rest.length !== 1 || !Number.isInteger(pr) || pr <= 0) return { kind: 'usage' };
  return { kind: 'pr', pr, dryRun: flags.includes('--dry-run') };
}
