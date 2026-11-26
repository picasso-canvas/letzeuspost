#!/usr/bin/env node
// What the builders and reviewers cost, summed per stage from ~/.letzeuspost/costs.jsonl (#448):
//   node scripts/cost.ts [--since YYYY-MM-DD]
import { formatCosts, readCosts, summariseCosts } from './lib/cost.ts';
import { isEntryPoint } from './lib/entry.ts';

const USAGE = 'usage: node scripts/cost.ts [--since YYYY-MM-DD]';

export function main(argv: string[]): number {
  const at = argv.indexOf('--since');
  const since = at >= 0 ? argv[at + 1] : undefined;
  const rest = argv.filter((a, i) => a !== '--since' && !(at >= 0 && i === at + 1));
  if (rest.length > 0 || (at >= 0 && (since === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(since)))) {
    console.error(USAGE);
    return 2;
  }
  const entries = readCosts();
  if (entries.length === 0) {
    console.log('No costs logged yet (~/.letzeuspost/costs.jsonl).');
    return 0;
  }
  console.log(formatCosts(summariseCosts(entries, since)));
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
