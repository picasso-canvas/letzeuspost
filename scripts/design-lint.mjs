// DESIGN.md lint (§21 Pipeline, #70). Run by `pnpm design:lint` and the CI job `design`.
// `design.md lint` exits 0 on warnings, and a text pair under WCAG AA is only a warning there. §05 says every pair
// passes AA, so this fails on everything but infos and unused-token warnings: borders and the focus ring are colours
// no text sits on, so no component names them (packages/ui/src/tokens/contrast.test.ts checks their 3:1).
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Warnings that pass: a token no component references. */
export const ALLOWED_WARNINGS = new Set(['orphaned-tokens']);

/**
 * @typedef {{ severity: string, rule: string, path?: string, message: string }} Finding
 * @param {unknown} report `design.md lint --format json`'s output, parsed
 * @returns {string[]} one line per problem; none when DESIGN.md passes
 */
export function designLintProblems(report) {
  const findings = /** @type {{ findings?: unknown } | null} */ (report)?.findings;
  if (!Array.isArray(findings)) return ['design.md lint printed no findings list'];
  // Anything but an info or an allowed warning fails, a severity this file doesn't know included.
  return /** @type {Finding[]} */ (findings)
    .filter(
      (f) => f.severity !== 'info' && !(f.severity === 'warning' && ALLOWED_WARNINGS.has(f.rule)),
    )
    .map((f) => `${f.path ?? f.rule}: ${f.message}`);
}

function main() {
  const file = process.argv[2] ?? 'DESIGN.md';
  // Its exit code is 1 on errors, and the JSON report is printed either way.
  let out;
  try {
    out = execFileSync('design.md', ['lint', '--format', 'json', file], { encoding: 'utf8' });
  } catch (error) {
    out = /** @type {{ stdout?: string }} */ (error).stdout ?? '';
  }
  let report = null;
  try {
    report = JSON.parse(out);
  } catch {
    // reported below as "no findings list"
  }
  const problems = designLintProblems(report);
  if (problems.length === 0) {
    console.log(`design-lint: ${file} passes (no errors; every text pair passes WCAG AA)`);
    return;
  }
  console.error(`design-lint: ${String(problems.length)} problem(s) in ${file}:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
