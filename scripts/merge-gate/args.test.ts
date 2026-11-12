import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.ts';

describe('parseArgs', () => {
  it('reads a PR number and the dry-run flag', () => {
    expect(parseArgs(['247'])).toEqual({ kind: 'pr', pr: 247, dryRun: false });
    expect(parseArgs(['247', '--dry-run'])).toEqual({ kind: 'pr', pr: 247, dryRun: true });
    expect(parseArgs(['--dry-run', '12'])).toEqual({ kind: 'pr', pr: 12, dryRun: true });
  });

  it('reads --sync-staging, which takes no PR', () => {
    expect(parseArgs(['--sync-staging'])).toEqual({ kind: 'sync-staging' });
  });

  it('refuses --sync-staging together with a PR or --dry-run, so it never reads as a merge', () => {
    expect(parseArgs(['--sync-staging', '247'])).toEqual({ kind: 'usage' });
    expect(parseArgs(['--sync-staging', '--dry-run'])).toEqual({ kind: 'usage' });
  });

  it('shows the usage for no PR, a bad PR, or an unknown flag', () => {
    expect(parseArgs([])).toEqual({ kind: 'usage' });
    expect(parseArgs(['abc'])).toEqual({ kind: 'usage' });
    expect(parseArgs(['0'])).toEqual({ kind: 'usage' });
    expect(parseArgs(['-5'])).toEqual({ kind: 'usage' });
    expect(parseArgs(['247', '--force'])).toEqual({ kind: 'usage' });
  });
});
