import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  areaRefusals,
  evidenceRefusal,
  findingIds,
  handoverRefusals,
  numberedFindings,
  parseAreas,
  requireFindingIds,
  roundRefusals,
} from './handover-checks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const HEAD = 'd5df703aa1b2c3d4e5f60718293a4b5c6d7e8f90';
const pr = (doneWhen: string, rest = '') =>
  `Closes #145\n\nAgent: Daedalus\n\n**Done when**\n${doneWhen}\n\n**Self-review**\n1. fine${rest}`;

describe('parseAreas', () => {
  it('reads each backticked path or glob from the Areas line', () => {
    expect(
      parseAreas(
        '**Goal:** x\n\n**Areas:** `packages/db/**`, `config/env.ts`\n\n**Depends on:** #1',
      ),
    ).toEqual({ patterns: ['packages/db/**', 'config/env.ts'] });
  });

  it("adds a file's own tests and stories only where the line says so, beside that file", () => {
    expect(
      parseAreas(
        '**Areas:** `packages/ui/src/components/button.tsx` and its tests and stories, `scripts/batch.ts`',
      ),
    ).toEqual({
      patterns: [
        'packages/ui/src/components/button.tsx',
        'scripts/batch.ts',
        'packages/ui/src/components/button.test.*',
        'packages/ui/src/components/button.*.test.*',
        'packages/ui/src/components/button-*.test.*',
        'packages/ui/src/components/button.spec.*',
        'packages/ui/src/components/button.*.spec.*',
        'packages/ui/src/components/button-*.spec.*',
        'packages/ui/src/components/button.stories.*',
        'packages/ui/src/components/button.*.stories.*',
      ],
    });
  });

  it('gives "its tests" in a part with no path to the last path before it', () => {
    expect(parseAreas('**Areas:** `scripts/foo.ts`, its tests')).toEqual({
      patterns: [
        'scripts/foo.ts',
        'scripts/foo.test.*',
        'scripts/foo.*.test.*',
        'scripts/foo-*.test.*',
        'scripts/foo.spec.*',
        'scripts/foo.*.spec.*',
        'scripts/foo-*.spec.*',
      ],
    });
  });

  it('gives "their tests" to every file before it on the line', () => {
    expect(parseAreas('**Areas:** `scripts/a.ts`, `scripts/b.ts`, their tests')).toEqual({
      patterns: [
        'scripts/a.ts',
        'scripts/b.ts',
        'scripts/a.test.*',
        'scripts/a.*.test.*',
        'scripts/a-*.test.*',
        'scripts/a.spec.*',
        'scripts/a.*.spec.*',
        'scripts/a-*.spec.*',
        'scripts/b.test.*',
        'scripts/b.*.test.*',
        'scripts/b-*.test.*',
        'scripts/b.spec.*',
        'scripts/b.*.spec.*',
        'scripts/b-*.spec.*',
      ],
    });
  });

  it('refuses an issue with no Areas line, or one with no path in it', () => {
    expect(parseAreas('**Goal:** x')).toEqual({ refusal: 'the issue has no **Areas:** line' });
    expect(parseAreas('**Areas:** the seven files above')).toEqual({
      refusal: "the issue's **Areas:** line names no path in backticks",
    });
  });
});

describe('areaRefusals', () => {
  it('matches strictly: letter case counts, and a dot folder is never a plain one', () => {
    expect(areaRefusals(['.github/x', 'Package.json'], ['github/x', 'package.json'])).toEqual([
      ".github/x is outside the task's Areas",
      "Package.json is outside the task's Areas",
    ]);
    expect(
      areaRefusals(
        ['packages/ui/.storybook/main.mjs', 'scripts/shipping-x.test.ts'],
        ['packages/ui/**', 'scripts/ship.test.*'],
      ),
    ).toEqual(["scripts/shipping-x.test.ts is outside the task's Areas"]);
  });

  const areas = [
    'packages/core/src/text/caption-length.ts',
    'packages/core/src/text/caption-length*.test.*',
  ];
  it('lets files inside the Areas through, and names each file outside them', () => {
    expect(
      areaRefusals(
        [
          'packages/core/src/text/caption-length.ts',
          'packages/core/src/text/caption-length.test.ts',
        ],
        areas,
      ),
    ).toEqual([]);
    expect(
      areaRefusals(['packages/core/src/text/caption-length.ts', 'package.json', 'a.ts'], areas),
    ).toEqual(["package.json is outside the task's Areas", "a.ts is outside the task's Areas"]);
  });
});

describe('evidenceRefusal', () => {
  it('accepts Done-when evidence that names the head commit (7 or more characters)', () => {
    expect(evidenceRefusal(pr('- [x] a test — passes at `d5df703`'), [HEAD])).toBeNull();
    expect(evidenceRefusal(pr(`- [x] a\n  \`pnpm check\` at ${HEAD}: green`), [HEAD])).toBeNull();
  });

  it('accepts any commit it is given, such as one the head only merged main into', () => {
    expect(
      evidenceRefusal(pr('- [x] a — at `abc1234`'), [HEAD, 'abc1234'.padEnd(40, '0')]),
    ).toBeNull();
  });

  it('refuses evidence that names only an older commit, or none, or that sits outside the Done-when list', () => {
    const refusal =
      "the Done-when evidence doesn't name the head commit d5df703: run the checks there and name it";
    expect(evidenceRefusal(pr('- [x] a — passes at `a767b3d`'), [HEAD])).toBe(refusal);
    expect(evidenceRefusal(pr('- [x] a — passes'), [HEAD])).toBe(refusal);
    expect(evidenceRefusal(pr('- [x] a — passes', '\n\nChecked at d5df703.'), [HEAD])).toBe(
      refusal,
    );
    expect(evidenceRefusal('no list at all, d5df703', [HEAD])).toBe(refusal);
  });

  it('never takes a 6-character prefix, which could match by chance', () => {
    expect(evidenceRefusal(pr('- [x] a — at d5df70'), [HEAD])).not.toBeNull();
  });
});

describe('findingIds', () => {
  it("reads each reviewer's numbered findings, once each, in order", () => {
    expect(
      findingIds(
        [
          'Argus:',
          'VERDICT: block',
          '[blocking] F1 evidence pr.md — x',
          '[nit] F2 simplicity a.ts:1 — y',
          'Cerberus:',
          '[should-fix] F1 security a.ts:2 — z',
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(findingIds('Argus F1, Argus F2 and Cerberus F1; again Argus F1.')).toEqual([
      'Argus F1',
      'Argus F2',
      'Cerberus F1',
    ]);
  });
});

describe('a shared or named test file beside the file (#148)', () => {
  it('also covers <file>-*.test.* for "its tests", but not for stories', () => {
    const areas = parseAreas('**Areas:** `scripts/dispatch.ts` and its tests and stories');
    expect('patterns' in areas && areas.patterns).toContain('scripts/dispatch-*.test.*');
    expect(
      areaRefusals(['scripts/dispatch-ship.test.ts'], 'patterns' in areas ? areas.patterns : []),
    ).toEqual([]);
    expect(
      areaRefusals(
        ['scripts/dispatch-ship.stories.tsx'],
        'patterns' in areas ? areas.patterns : [],
      ),
    ).toEqual(["scripts/dispatch-ship.stories.tsx is outside the task's Areas"]);
    // A name that only starts like the file, with no dash, is another file.
    expect(
      areaRefusals(['scripts/dispatcher.test.ts'], 'patterns' in areas ? areas.patterns : []),
    ).toHaveLength(1);
  });
});

describe('requireFindingIds (what dispatch records)', () => {
  it("doesn't add an older round's id that a finding's text or a reviewer's section names", () => {
    expect(
      requireFindingIds(
        [
          'Cerberus:',
          '[nit] F1 evidence pr.md — still open since Argus F3 in round 1',
          'Argus F4 said the same, and Iris F2 too.',
        ].join('\n'),
      ),
    ).toEqual(['Cerberus F1']);
  });

  it('only a heading-like line starts a reviewer section', () => {
    // Prose that starts with a reviewer's name, or bolds one, switches nothing.
    expect(
      requireFindingIds(
        [
          'Cerberus:',
          'Argus thinks the retry is wrong, but this one is mine.',
          '**Iris** would like it too, said the builder.',
          '[nit] F1 evidence pr.md — x',
        ].join('\n'),
      ),
    ).toEqual(['Cerberus F1']);
    // With no heading at all, such a line leaves the finding with no reviewer.
    expect(() => requireFindingIds('Argus thinks so.\n[nit] F1 evidence pr.md — x')).toThrow(
      /no reviewer above it/,
    );
    // The four heading forms still work.
    expect(
      requireFindingIds(
        [
          'Argus:',
          '[nit] F1 a x — y',
          '## Cerberus',
          '[nit] F2 a x — y',
          '**Iris**',
          '[nit] F3 a x — y',
          '🦉 Athena: review record: **Argus**, **block** for `c22cd7c`.',
          '[nit] F4 a x — y',
        ].join('\n'),
      ),
    ).toEqual(['Argus F1', 'Cerberus F2', 'Iris F3', 'Argus F4']);
  });

  it("takes CI's own failures with an id, written out or under a CI heading", () => {
    expect(requireFindingIds('Fix CI F1 and Argus F2.')).toEqual(['CI F1', 'Argus F2']);
    expect(
      requireFindingIds(
        'CI:\n[blocking] F1 tests packages/core/a.test.ts:3 — the services job failed',
      ),
    ).toEqual(['CI F1']);
    expect(roundRefusals(`x\n\n**Round 2**\n- CI F1: fixed.`, ['CI F1'])).toEqual([]);
    expect(roundRefusals(`x\n\n**Round 2**\n- Argus F1: fixed.`, ['CI F1'])).toEqual([
      "the Round 2 section doesn't answer CI F1",
    ]);
  });

  it("reads the reviewers' own output, grouped under each reviewer's name", () => {
    expect(
      requireFindingIds(
        [
          'Argus:',
          'VERDICT: block',
          '[blocking] F1 evidence pr.md — x',
          '- **[nit]** F2 simplicity a.ts:1 — y',
          '',
          '## Cerberus',
          '[should-fix] F1 security a.ts:2 — z',
          '**Iris**',
          '[nit] F3 copy b.tsx — w',
        ].join('\n'),
      ),
    ).toEqual(['Argus F1', 'Argus F2', 'Cerberus F1', 'Iris F3']);
  });

  it("reads Athena's posted review records, and the ids a reviewer mentions in prose don't stand in for the rest", () => {
    const comments = [
      '🦉 Athena: review record: **Argus**, **block** for `c22cd7c`.',
      '',
      'VERDICT: block',
      '',
      '[blocking] F1 correctness scripts/dispatch.ts:358 — Round 2 answers Argus F1 only in part — fix',
      '[should-fix] F2 correctness scripts/merge-gate/evaluate.ts:136 — x — y',
      '',
      '🦉 Athena: review record: **Cerberus**, **block** for `c22cd7c`.',
      '',
      'VERDICT: block',
      '[nit] F3 tests-first scripts/merge-gate/collect.test.ts:247 — z',
    ].join('\n');
    expect(requireFindingIds(comments)).toEqual(['Argus F1', 'Argus F2', 'Cerberus F3']);
  });

  it('refuses a numbered finding with no reviewer above it, rather than dropping it', () => {
    expect(() =>
      requireFindingIds('Fix Argus F1 as discussed.\n[blocking] F2 evidence pr.md — orphan'),
    ).toThrow(/no reviewer above it: \[blocking\] F2/);
  });

  it('also takes ids Athena wrote out, and refuses a findings file with none', () => {
    expect(requireFindingIds('Fix Argus F2 and Cerberus F1.')).toEqual(['Argus F2', 'Cerberus F1']);
    expect(() => requireFindingIds('[blocking] F1 evidence pr.md — no reviewer named')).toThrow(
      /no reviewer above it/,
    );
    expect(() => requireFindingIds('please fix the button')).toThrow(/no finding ids/);
  });
});

describe('roundRefusals', () => {
  const ids = ['Argus F1', 'Cerberus F2'];
  it('needs a Round section that answers every finding by its id', () => {
    const text = `${pr('- [x] a — at d5df703')}\n\n**Round 2** (round 1 at \`a767b3d\`):\n- Argus F1 [blocking]: fixed.\n- Cerberus F2 [nit]: done.`;
    expect(roundRefusals(text, ids)).toEqual([]);
  });

  it('reads the latest Round section, not an earlier one', () => {
    const text = `x\n\n**Round 2**\n- Argus F1: fixed. Cerberus F2: fixed.\n\n**Round 3**\n- Argus F1: fixed again.`;
    expect(roundRefusals(text, ids)).toEqual(["the Round 3 section doesn't answer Cerberus F2"]);
  });

  it('refuses a fix round with no Round section', () => {
    expect(roundRefusals(pr('- [x] a'), ids)).toEqual([
      'a fix round needs a **Round N** section answering each finding (Argus F1, Cerberus F2)',
    ]);
  });

  it('asks nothing when there were no numbered findings', () => {
    expect(roundRefusals(pr('- [x] a'), [])).toEqual([]);
  });
});

describe('handoverRefusals (what ship checks)', () => {
  const issue = '**Areas:** `packages/core/src/text/caption-length.ts` and its tests';
  const ok = {
    prText: pr('- [x] a — passes at `d5df703`'),
    issueBody: issue,
    changedFiles: ['packages/core/src/text/caption-length.ts'],
    headSha: HEAD,
    findings: [] as string[],
  };
  it('passes a hand-over that names its head, stays in its Areas and has no findings to answer', () => {
    expect(handoverRefusals(ok)).toEqual([]);
  });

  it('collects every refusal at once', () => {
    expect(
      handoverRefusals({
        ...ok,
        prText: pr('- [x] a — passes'),
        changedFiles: [...ok.changedFiles, 'package.json'],
        findings: ['Argus F1'],
      }),
    ).toEqual([
      "the Done-when evidence doesn't name the head commit d5df703: run the checks there and name it",
      'a fix round needs a **Round N** section answering each finding (Argus F1)',
      "package.json is outside the task's Areas",
    ]);
  });
});

describe('numberedFindings', () => {
  it('reads the numbers of typed findings in a review summary, in any markup', () => {
    expect(
      numberedFindings(
        'VERDICT: block\n[blocking] F1 evidence a — x\n- **[nit]** F3 copy b — y\nF9 in prose',
      ),
    ).toEqual([1, 3]);
  });
});

describe('Daedalus checks its own hand-over first', () => {
  it('is told to name the head commit, answer each finding by its id and stay in the Areas', () => {
    const text = readFileSync(join(ROOT, '.claude/agents/daedalus-builder.md'), 'utf8');
    expect(text).toContain('git rev-parse --short HEAD');
    expect(text).toContain('**Round N**');
    expect(text).toContain('git diff --name-only');
  });
});
