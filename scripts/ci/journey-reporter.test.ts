import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The services job's journey steps (#156): each runner's report is uploaded right after its own step, from a folder
// no later step's code can write into, so a test can't forge the other runner's file (Argus F2, Cerberus F1 on #171).
const yml = readFileSync(new URL('../../.github/workflows/services.yml', import.meta.url), 'utf8');
const step = (name: string): string => {
  const start = yml.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`no step "${name}"`);
  const next = yml.indexOf('\n      - name: ', start + 1);
  return yml.slice(start, next < 0 ? undefined : next);
};
const at = (name: string) => yml.indexOf(`      - name: ${name}\n`);

describe("services.yml's journey reports (#156)", () => {
  it("uploads Vitest's report before any end-to-end code runs", () => {
    expect(step('Integration tests and the tenancy suite')).toContain(
      'LZP_JOURNEY_DIR="$RUNNER_TEMP/journeys-vitest"',
    );
    expect(at('Upload the Vitest journey report')).toBeGreaterThan(
      at('Integration tests and the tenancy suite'),
    );
    expect(at('Upload the Vitest journey report')).toBeLessThan(at('End-to-end tests'));
    expect(step('Upload the Vitest journey report')).toContain('name: journeys-vitest');
  });

  it('gives Playwright a fresh folder and uploads its report only when the step ran', () => {
    expect(step('End-to-end tests')).toMatch(
      /rm -rf "\$RUNNER_TEMP\/journeys-playwright"\n\s+mkdir "\$RUNNER_TEMP\/journeys-playwright"/,
    );
    const upload = step('Upload the Playwright journey report');
    expect(upload).toContain("steps.e2e.outcome != 'skipped'");
    expect(upload).toContain('name: journeys-playwright');
  });

  it('never hands the folder to later steps through the job environment', () => {
    expect(yml).not.toMatch(/LZP_JOURNEY_DIR=.*>>\s*"?\$GITHUB_ENV/);
  });
});
