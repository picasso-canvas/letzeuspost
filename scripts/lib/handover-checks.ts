// The hand-over checks (§19 Learning loop, #138): the three mistakes reviewers kept finding, refused before any review
// runs. Ship runs them on a builder's hand-over; the merge gate runs them on Athena's own PRs into main. They only
// refuse what's missing: a passing check is never taken as proof that anything was checked (§19 "What the gate trusts").

const AREAS = /^\*\*Areas:\*\*(.*)$/m;

/**
 * The paths and globs on the issue's `**Areas:**` line. "its tests" (or "stories") adds the files beside the file it
 * follows, in the same comma-separated part; "their tests" adds them beside every file before it on the line. A
 * negation ("not its tests") isn't read as one: Athena writes Areas plainly.
 */
export function parseAreas(issueBody: string): { patterns: string[] } | { refusal: string } {
  const line = AREAS.exec(issueBody)?.[1];
  if (line === undefined) return { refusal: 'the issue has no **Areas:** line' };
  const named: string[] = [];
  const tested: string[] = [];
  const storied: string[] = [];
  for (const part of line.split(',')) {
    const here = [...part.matchAll(/`([^`\s]+)`/g)].map((m) => m[1] ?? '');
    named.push(...here);
    const files = (list: string[]) =>
      list.filter((p) => !p.includes('*') && /\.[a-z0-9]+$/i.test(p));
    const add = (to: string[], word: string) => {
      if (new RegExp(`\\bits ${word}\\b|\\band ${word}\\b`, 'i').test(part))
        to.push(...files(here));
      if (new RegExp(`\\btheir\\b[^,]*\\b${word}\\b`, 'i').test(part)) to.push(...files(named));
    };
    add(tested, 'tests');
    add(storied, 'stories');
  }
  if (named.length === 0)
    return { refusal: "the issue's **Areas:** line names no path in backticks" };
  const beside = (files: string[], kinds: string[]) =>
    [...new Set(files)].flatMap((file) => {
      const stem = file.replace(/\.[a-z0-9]+$/i, '');
      return kinds.flatMap((kind) => [`${stem}.${kind}.*`, `${stem}.*.${kind}.*`]);
    });
  return {
    patterns: [...named, ...beside(tested, ['test', 'spec']), ...beside(storied, ['stories'])],
  };
}

/** A glob as a strict, whole-path match: letter case counts and `*` crosses no `/`; `**` crosses any. */
function globRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Strict, unlike the protected-path match (which over-matches to fail closed): here over-matching would fail open. */
export function areaRefusals(
  changedFiles: readonly string[],
  patterns: readonly string[],
): string[] {
  const globs = patterns.map(globRegex);
  return changedFiles
    .filter((file) => !globs.some((glob) => glob.test(file)))
    .map((file) => `${file} is outside the task's Areas`);
}

/** The Done-when list: its items and the lines indented under them (a line at column 0 ends it, as Daedalus is told). */
function doneWhen(text: string): string {
  const lines = text.split(/\r\n?|\n/);
  const start = lines.findIndex((line) => /^\*\*Done when\*\*/.test(line));
  if (start === -1) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^- \[/.test(line) || /^\s/.test(line)) out.push(line);
    else break;
  }
  return out.join('\n');
}

/** The evidence must name a commit it was taken at: the head, or (at the gate) one the head only merged main into. */
export function evidenceRefusal(prText: string, acceptedShas: readonly string[]): string | null {
  const named = [...doneWhen(prText).matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]);
  if (named.some((sha) => acceptedShas.some((accepted) => accepted.startsWith(sha)))) return null;
  return `the Done-when evidence doesn't name the head commit ${(acceptedShas[0] ?? '').slice(0, 7)}: run the checks there and name it`;
}

/** `Argus F1`-style ids in a text, once each, in order of first mention. */
export function findingIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(Argus|Cerberus|Iris) F(\d+)\b/g)].map((m) => m[0]))];
}

/** The finding numbers in a reviewer's summary: `[severity] F<n> <type> …`, behind any list or emphasis markup. */
export function numberedFindings(summary: string): number[] {
  return summary
    .split(/\r\n?|\n/)
    .map((line) => /^[\s*_>-]*\[(?:blocking|should-fix|nit)\][*_]*\s+F(\d+)\b/i.exec(line)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
}

const REVIEWER_HEADING = /^[#*_\s>-]*(Argus|Cerberus|Iris)\b[^[\]]*$/;

/**
 * The finding ids in Athena's findings file for a fix round: ids written out (`Argus F1`), and the reviewers' own
 * `[severity] F<n>` lines under each reviewer's name (`Argus:`, `## Cerberus`, `**Iris**`). A file with none is
 * refused, so a fix round can't skip its Round section by accident.
 */
export function requireFindingIds(text: string): string[] {
  const ids: string[] = [];
  let reviewer: string | undefined;
  for (const line of text.split(/\r\n?|\n/)) {
    const heading = REVIEWER_HEADING.exec(line);
    if (heading && !/\bF\d+\b/.test(line)) reviewer = heading[1];
    ids.push(...findingIds(line));
    if (reviewer !== undefined)
      ids.push(...numberedFindings(line).map((n) => `${reviewer ?? ''} F${String(n)}`));
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0)
    throw new Error(
      "the findings file has no finding ids: write each as `Argus F1`, or keep the reviewers' own `[severity] F<n>` lines under each reviewer's name",
    );
  return unique;
}

/** A fix round answers every finding id in its latest **Round N** section. */
export function roundRefusals(prText: string, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const rounds = [...prText.matchAll(/^\*\*Round (\d+)\*\*/gm)];
  const last = rounds.at(-1);
  if (last === undefined)
    return [`a fix round needs a **Round N** section answering each finding (${ids.join(', ')})`];
  const from = last.index + last[0].length;
  const next = /^\*\*[^*\n]+\*\*/m.exec(prText.slice(from));
  const section = prText.slice(from, next === null ? undefined : from + next.index);
  const answered = new Set(findingIds(section));
  return ids
    .filter((id) => !answered.has(id))
    .map((id) => `the Round ${last[1] ?? ''} section doesn't answer ${id}`);
}

/** Everything ship refuses in a hand-over, at once. */
export function handoverRefusals(h: {
  prText: string;
  issueBody: string;
  changedFiles: readonly string[];
  headSha: string;
  findings: readonly string[];
}): string[] {
  const areas = parseAreas(h.issueBody);
  const evidence = evidenceRefusal(h.prText, [h.headSha]);
  return [
    ...(evidence === null ? [] : [evidence]),
    ...roundRefusals(h.prText, h.findings),
    ...('refusal' in areas ? [areas.refusal] : areaRefusals(h.changedFiles, areas.patterns)),
  ];
}
